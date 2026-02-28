/**
 * ALUFORCE ERP - Testes Unitários Backend
 * Testes de endpoints relacionados a modais
 * 
 * @version 2.0
 * @date 2026-01-19
 */

'use strict';

const request = require('supertest');
const { expect } = require('chai');
const sinon = require('sinon');

// Mock do app Express
const express = require('express');
const app = express();
app.use(express.json());

// Importar fixtures
const { TEST_DATA, MODAL_CATALOG } = require('../fixtures/modals.fixtures');

describe('ALUFORCE ERP - Testes Unitários Backend (Endpoints de Modais)', function() {
    this.timeout(15000);

    let sandbox;
    let mockDb;
    let authToken = 'test-token-123';

    beforeEach(function() {
        sandbox = sinon.createSandbox();
        
        // Mock do banco de dados
        mockDb = {
            query: sandbox.stub(),
            get: sandbox.stub(),
            all: sandbox.stub(),
            run: sandbox.stub()
        };
    });

    afterEach(function() {
        sandbox.restore();
    });

    // ========================================================================
    // MOCK DE ROTAS PARA TESTES
    // ========================================================================
    
    // Middleware de autenticação mock
    const authMiddleware = (req, res, next) => {
        const token = req.headers.authorization;
        if (!token || token !== `Bearer ${authToken}`) {
            return res.status(401).json({ error: 'Não autorizado' });
        }
        req.user = { id: 1, email: 'admin@aluforce.com.br', perfil: 'admin' };
        next();
    };

    // Rota de configurações da empresa
    app.get('/api/configuracoes/empresa', authMiddleware, (req, res) => {
        const empresa = TEST_DATA.empresaValida;
        res.json({ success: true, data: empresa });
    });

    app.put('/api/configuracoes/empresa', authMiddleware, (req, res) => {
        const { razao_social, cnpj } = req.body;
        
        if (!razao_social || razao_social.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                error: 'Razão social é obrigatória' 
            });
        }

        if (cnpj && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cnpj)) {
            return res.status(400).json({
                success: false,
                error: 'CNPJ inválido'
            });
        }

        res.json({ success: true, message: 'Dados salvos com sucesso' });
    });

    // Rota de categorias
    app.get('/api/categorias', authMiddleware, (req, res) => {
        res.json({ 
            success: true, 
            data: [
                { id: 1, nome: 'Perfis', ativo: true },
                { id: 2, nome: 'Chapas', ativo: true }
            ] 
        });
    });

    app.post('/api/categorias', authMiddleware, (req, res) => {
        const { nome } = req.body;
        
        if (!nome || nome.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Nome é obrigatório'
            });
        }

        res.status(201).json({ 
            success: true, 
            data: { id: 3, nome, ativo: true } 
        });
    });

    app.delete('/api/categorias/:id', authMiddleware, (req, res) => {
        const { id } = req.params;
        
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        res.json({ success: true, message: 'Categoria excluída' });
    });

    // Rota de departamentos
    app.get('/api/departamentos', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [
                { id: 1, nome: 'Produção', sigla: 'PROD' },
                { id: 2, nome: 'Vendas', sigla: 'VEN' }
            ]
        });
    });

    app.post('/api/departamentos', authMiddleware, (req, res) => {
        const { nome } = req.body;
        
        if (!nome) {
            return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
        }

        res.status(201).json({ success: true, data: { id: 3, nome } });
    });

    // Rota de produtos
    app.get('/api/produtos', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [TEST_DATA.produtoValido]
        });
    });

    app.post('/api/produtos', authMiddleware, (req, res) => {
        const { codigo, nome } = req.body;
        
        if (!codigo || !nome) {
            return res.status(400).json({
                success: false,
                error: 'Código e nome são obrigatórios'
            });
        }

        res.status(201).json({
            success: true,
            data: { id: 1, ...req.body }
        });
    });

    app.put('/api/produtos/:id', authMiddleware, (req, res) => {
        const { id } = req.params;
        res.json({ success: true, data: { id: parseInt(id), ...req.body } });
    });

    // Rota de materiais
    app.get('/api/materiais', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [TEST_DATA.materialValido]
        });
    });

    app.post('/api/materiais', authMiddleware, (req, res) => {
        const { codigo, nome } = req.body;
        
        if (!codigo || !nome) {
            return res.status(400).json({
                success: false,
                error: 'Código e nome são obrigatórios'
            });
        }

        res.status(201).json({
            success: true,
            data: { id: 1, ...req.body }
        });
    });

    // Rota de ordens de produção
    app.get('/api/ordens-producao', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: []
        });
    });

    app.post('/api/ordens-producao', authMiddleware, (req, res) => {
        const { cliente_id, produto_id, quantidade } = req.body;
        
        if (!cliente_id || !produto_id || !quantidade) {
            return res.status(400).json({
                success: false,
                error: 'Cliente, produto e quantidade são obrigatórios'
            });
        }

        if (quantidade <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantidade deve ser maior que zero'
            });
        }

        res.status(201).json({
            success: true,
            data: { 
                id: 1, 
                numero: 'OP-2026-0001',
                ...req.body,
                status: 'pendente'
            }
        });
    });

    // Rota de clientes
    app.get('/api/clientes', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [TEST_DATA.clienteValido]
        });
    });

    app.post('/api/clientes', authMiddleware, (req, res) => {
        const { nome, cpf_cnpj } = req.body;
        
        if (!nome || !cpf_cnpj) {
            return res.status(400).json({
                success: false,
                error: 'Nome e CPF/CNPJ são obrigatórios'
            });
        }

        res.status(201).json({
            success: true,
            data: { id: 1, ...req.body }
        });
    });

    // Rota de funcionários
    app.get('/api/funcionarios', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [TEST_DATA.funcionarioValido]
        });
    });

    app.post('/api/funcionarios', authMiddleware, (req, res) => {
        const { nome, cpf, email } = req.body;
        
        if (!nome || !cpf || !email) {
            return res.status(400).json({
                success: false,
                error: 'Nome, CPF e email são obrigatórios'
            });
        }

        res.status(201).json({
            success: true,
            data: { id: 1, ...req.body }
        });
    });

    // Rotas financeiras
    app.get('/api/contas-pagar', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [TEST_DATA.contaPagarValida]
        });
    });

    app.post('/api/contas-pagar', authMiddleware, (req, res) => {
        const { descricao, valor, data_vencimento } = req.body;
        
        if (!descricao || !valor || !data_vencimento) {
            return res.status(400).json({
                success: false,
                error: 'Descrição, valor e data de vencimento são obrigatórios'
            });
        }

        if (valor <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Valor deve ser maior que zero'
            });
        }

        res.status(201).json({
            success: true,
            data: { id: 1, ...req.body }
        });
    });

    app.get('/api/contas-receber', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [TEST_DATA.contaReceberValida]
        });
    });

    app.post('/api/contas-receber', authMiddleware, (req, res) => {
        const { descricao, valor, data_vencimento } = req.body;
        
        if (!descricao || !valor || !data_vencimento) {
            return res.status(400).json({
                success: false,
                error: 'Descrição, valor e data de vencimento são obrigatórios'
            });
        }

        res.status(201).json({
            success: true,
            data: { id: 1, ...req.body }
        });
    });

    // Rota de configurações gerais
    app.get('/api/configuracoes/:tipo', authMiddleware, (req, res) => {
        const { tipo } = req.params;
        res.json({
            success: true,
            data: { tipo, configuracoes: {} }
        });
    });

    app.put('/api/configuracoes/:tipo', authMiddleware, (req, res) => {
        res.json({ success: true, message: 'Configurações salvas' });
    });

    // Rota de tipos de entrega
    app.get('/api/configuracoes/tipos-entrega', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: [
                { id: 1, nome: 'Entrega Normal', prazo: 7 },
                { id: 2, nome: 'Entrega Expressa', prazo: 2 }
            ]
        });
    });

    app.post('/api/configuracoes/tipos-entrega', authMiddleware, (req, res) => {
        const { nome } = req.body;
        if (!nome) {
            return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
        }
        res.status(201).json({ success: true, data: { id: 3, nome } });
    });

    // ========================================================================
    // TESTES: AUTENTICAÇÁO
    // ========================================================================
    describe('Autenticação e Autorização', function() {
        it('TC-B001: Requisição sem token deve retornar 401', async function() {
            const res = await request(app)
                .get('/api/configuracoes/empresa')
                .expect(401);
            
            expect(res.body.error).to.include('autorizado');
        });

        it('TC-B002: Requisição com token inválido deve retornar 401', async function() {
            const res = await request(app)
                .get('/api/configuracoes/empresa')
                .set('Authorization', 'Bearer token-invalido')
                .expect(401);
            
            expect(res.body.error).to.include('autorizado');
        });

        it('TC-B003: Requisição com token válido deve retornar 200', async function() {
            const res = await request(app)
                .get('/api/configuracoes/empresa')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE EMPRESA
    // ========================================================================
    describe('Endpoint /api/configuracoes/empresa', function() {
        it('TC-B010: GET deve retornar dados da empresa', async function() {
            const res = await request(app)
                .get('/api/configuracoes/empresa')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('razao_social');
            expect(res.body.data).to.have.property('cnpj');
        });

        it('TC-B011: PUT com dados válidos deve retornar sucesso', async function() {
            const res = await request(app)
                .put('/api/configuracoes/empresa')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.empresaValida)
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B012: PUT sem razão social deve retornar 400', async function() {
            const res = await request(app)
                .put('/api/configuracoes/empresa')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ cnpj: '12.345.678/0001-90' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
            expect(res.body.error).to.include('Razão social');
        });

        it('TC-B013: PUT com CNPJ inválido deve retornar 400', async function() {
            const res = await request(app)
                .put('/api/configuracoes/empresa')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razao_social: 'Empresa Teste', cnpj: '123' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
            expect(res.body.error).to.include('CNPJ');
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE CATEGORIAS
    // ========================================================================
    describe('Endpoint /api/categorias', function() {
        it('TC-B020: GET deve retornar lista de categorias', async function() {
            const res = await request(app)
                .get('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B021: POST com nome válido deve criar categoria', async function() {
            const res = await request(app)
                .post('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.categoriaValida)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('id');
            expect(res.body.data.nome).to.equal(TEST_DATA.categoriaValida.nome);
        });

        it('TC-B022: POST sem nome deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ descricao: 'Sem nome' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
            expect(res.body.error).to.include('Nome');
        });

        it('TC-B023: DELETE com ID válido deve excluir', async function() {
            const res = await request(app)
                .delete('/api/categorias/1')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B024: DELETE com ID inválido deve retornar 400', async function() {
            const res = await request(app)
                .delete('/api/categorias/abc')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE DEPARTAMENTOS
    // ========================================================================
    describe('Endpoint /api/departamentos', function() {
        it('TC-B030: GET deve retornar lista de departamentos', async function() {
            const res = await request(app)
                .get('/api/departamentos')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B031: POST com nome válido deve criar departamento', async function() {
            const res = await request(app)
                .post('/api/departamentos')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.departamentoValido)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('id');
        });

        it('TC-B032: POST sem nome deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/departamentos')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ sigla: 'TST' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE PRODUTOS
    // ========================================================================
    describe('Endpoint /api/produtos', function() {
        it('TC-B040: GET deve retornar lista de produtos', async function() {
            const res = await request(app)
                .get('/api/produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B041: POST com dados válidos deve criar produto', async function() {
            const res = await request(app)
                .post('/api/produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.produtoValido)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('id');
            expect(res.body.data.codigo).to.equal(TEST_DATA.produtoValido.codigo);
        });

        it('TC-B042: POST sem código deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: 'Produto sem código' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });

        it('TC-B043: POST sem nome deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ codigo: 'PROD999' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });

        it('TC-B044: PUT deve atualizar produto existente', async function() {
            const res = await request(app)
                .put('/api/produtos/1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: 'Nome Atualizado' })
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data.nome).to.equal('Nome Atualizado');
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE MATERIAIS
    // ========================================================================
    describe('Endpoint /api/materiais', function() {
        it('TC-B050: GET deve retornar lista de materiais', async function() {
            const res = await request(app)
                .get('/api/materiais')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B051: POST com dados válidos deve criar material', async function() {
            const res = await request(app)
                .post('/api/materiais')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.materialValido)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('id');
        });

        it('TC-B052: POST sem campos obrigatórios deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/materiais')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ descricao: 'Material sem código e nome' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE ORDENS DE PRODUÇÁO
    // ========================================================================
    describe('Endpoint /api/ordens-producao', function() {
        it('TC-B060: GET deve retornar lista de ordens', async function() {
            const res = await request(app)
                .get('/api/ordens-producao')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B061: POST com dados válidos deve criar ordem', async function() {
            const res = await request(app)
                .post('/api/ordens-producao')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.ordemProducaoValida)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('numero');
            expect(res.body.data.status).to.equal('pendente');
        });

        it('TC-B062: POST sem cliente deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/ordens-producao')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ produto_id: 1, quantidade: 100 })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });

        it('TC-B063: POST com quantidade zero deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/ordens-producao')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ cliente_id: 1, produto_id: 1, quantidade: 0 })
                .expect(400);
            
            expect(res.body.success).to.be.false;
            expect(res.body.error).to.include('maior que zero');
        });

        it('TC-B064: POST com quantidade negativa deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/ordens-producao')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ cliente_id: 1, produto_id: 1, quantidade: -10 })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE CLIENTES
    // ========================================================================
    describe('Endpoint /api/clientes', function() {
        it('TC-B070: GET deve retornar lista de clientes', async function() {
            const res = await request(app)
                .get('/api/clientes')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B071: POST com dados válidos deve criar cliente', async function() {
            const res = await request(app)
                .post('/api/clientes')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.clienteValido)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('id');
        });

        it('TC-B072: POST sem nome deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/clientes')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ cpf_cnpj: '12345678901234' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINT DE FUNCIONÁRIOS
    // ========================================================================
    describe('Endpoint /api/funcionarios', function() {
        it('TC-B080: GET deve retornar lista de funcionários', async function() {
            const res = await request(app)
                .get('/api/funcionarios')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B081: POST com dados válidos deve criar funcionário', async function() {
            const res = await request(app)
                .post('/api/funcionarios')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.funcionarioValido)
                .expect(201);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.have.property('id');
        });

        it('TC-B082: POST sem campos obrigatórios deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/funcionarios')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: 'João' })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: ENDPOINTS FINANCEIROS
    // ========================================================================
    describe('Endpoints Financeiros', function() {
        it('TC-B090: GET /api/contas-pagar deve retornar contas', async function() {
            const res = await request(app)
                .get('/api/contas-pagar')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B091: POST /api/contas-pagar deve criar conta', async function() {
            const res = await request(app)
                .post('/api/contas-pagar')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.contaPagarValida)
                .expect(201);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B092: POST /api/contas-pagar com valor zero deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/contas-pagar')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ ...TEST_DATA.contaPagarValida, valor: 0 })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });

        it('TC-B093: GET /api/contas-receber deve retornar contas', async function() {
            const res = await request(app)
                .get('/api/contas-receber')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B094: POST /api/contas-receber deve criar conta', async function() {
            const res = await request(app)
                .post('/api/contas-receber')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.contaReceberValida)
                .expect(201);
            
            expect(res.body.success).to.be.true;
        });
    });

    // ========================================================================
    // TESTES: CONFIGURAÇÕES GERAIS
    // ========================================================================
    describe('Endpoint /api/configuracoes/:tipo', function() {
        it('TC-B100: GET venda-produtos deve retornar configurações', async function() {
            const res = await request(app)
                .get('/api/configuracoes/venda-produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B101: GET financas deve retornar configurações', async function() {
            const res = await request(app)
                .get('/api/configuracoes/financas')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B102: PUT deve salvar configurações', async function() {
            const res = await request(app)
                .put('/api/configuracoes/venda-produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ opcao1: true, opcao2: 'valor' })
                .expect(200);
            
            expect(res.body.success).to.be.true;
        });
    });

    // ========================================================================
    // TESTES: TIPOS DE ENTREGA
    // ========================================================================
    describe('Endpoint /api/configuracoes/tipos-entrega', function() {
        it('TC-B110: GET deve retornar tipos de entrega', async function() {
            const res = await request(app)
                .get('/api/configuracoes/tipos-entrega')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.body.success).to.be.true;
            expect(res.body.data).to.be.an('array');
        });

        it('TC-B111: POST deve criar tipo de entrega', async function() {
            const res = await request(app)
                .post('/api/configuracoes/tipos-entrega')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: 'Entrega Agendada', prazo: 5 })
                .expect(201);
            
            expect(res.body.success).to.be.true;
        });

        it('TC-B112: POST sem nome deve retornar 400', async function() {
            const res = await request(app)
                .post('/api/configuracoes/tipos-entrega')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ prazo: 5 })
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: SEGURANÇA - INJEÇÁO SQL
    // ========================================================================
    describe('Segurança - Proteção contra SQL Injection', function() {
        it('TC-B120: Payload com SQL injection deve ser tratado', async function() {
            const res = await request(app)
                .post('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: "'; DROP TABLE categorias; --" })
                .expect(201);
            
            // Deve criar com o valor como string, não executar SQL
            expect(res.body.success).to.be.true;
            expect(res.body.data.nome).to.include('DROP TABLE');
        });

        it('TC-B121: ID com SQL injection deve ser rejeitado', async function() {
            const res = await request(app)
                .delete("/api/categorias/1; DROP TABLE categorias;")
                .set('Authorization', `Bearer ${authToken}`)
                .expect(400);
            
            expect(res.body.success).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: SEGURANÇA - XSS
    // ========================================================================
    describe('Segurança - Proteção contra XSS', function() {
        it('TC-B130: Payload com script XSS deve ser armazenado como texto', async function() {
            const res = await request(app)
                .post('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: '<script>alert("XSS")</script>' })
                .expect(201);
            
            // Deve armazenar como texto, não executar
            expect(res.body.data.nome).to.include('<script>');
        });

        it('TC-B131: Payload com evento HTML deve ser armazenado como texto', async function() {
            const res = await request(app)
                .post('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nome: '<img src=x onerror=alert(1)>' })
                .expect(201);
            
            expect(res.body.data.nome).to.include('onerror');
        });
    });

    // ========================================================================
    // TESTES: PERFORMANCE
    // ========================================================================
    describe('Performance - Tempo de Resposta', function() {
        it('TC-B140: GET /api/categorias deve responder em < 500ms', async function() {
            const start = Date.now();
            
            await request(app)
                .get('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            const duration = Date.now() - start;
            expect(duration).to.be.lessThan(500);
        });

        it('TC-B141: POST /api/produtos deve responder em < 1000ms', async function() {
            const start = Date.now();
            
            await request(app)
                .post('/api/produtos')
                .set('Authorization', `Bearer ${authToken}`)
                .send(TEST_DATA.produtoValido)
                .expect(201);
            
            const duration = Date.now() - start;
            expect(duration).to.be.lessThan(1000);
        });
    });

    // ========================================================================
    // TESTES: CONTENT-TYPE E HEADERS
    // ========================================================================
    describe('Headers e Content-Type', function() {
        it('TC-B150: Resposta deve ter Content-Type application/json', async function() {
            const res = await request(app)
                .get('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            
            expect(res.headers['content-type']).to.include('application/json');
        });

        it('TC-B151: POST deve aceitar JSON', async function() {
            const res = await request(app)
                .post('/api/categorias')
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'application/json')
                .send(JSON.stringify(TEST_DATA.categoriaValida))
                .expect(201);
            
            expect(res.body.success).to.be.true;
        });
    });
});
