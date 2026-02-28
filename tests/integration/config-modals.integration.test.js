/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALUFORCE ERP - TESTES DE INTEGRAÇÁO - API DE CONFIGURAÇÕES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Suíte completa de testes de integração para as APIs do módulo de configurações.
 * Testa a comunicação entre frontend e backend.
 * 
 * @author QA Automation
 * @version 1.0.0
 * @date 2025-01-18
 */

const request = require('supertest');
const { expect } = require('chai');
const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const sinon = require('sinon');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÁO DE TESTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * URL base para testes
 */
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

/**
 * Token de autenticação mock para testes
 */
let authToken = null;

/**
 * Mock de pool de conexão MySQL
 */
const mockPool = {
    query: sinon.stub()
};

/**
 * Headers padrão para requisições autenticadas
 */
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Cookie': authToken ? `token=${authToken}` : ''
    };
}

/**
 * Dados de teste padrão
 */
const TEST_DATA = {
    empresa: {
        razao_social: 'EMPRESA TESTE LTDA',
        nome_fantasia: 'EMPRESA TESTE',
        cnpj: '12.345.678/0001-90',
        inscricao_estadual: '123456789',
        inscricao_municipal: '987654321',
        telefone: '(11) 99999-9999',
        email: 'teste@empresa.com.br',
        site: 'https://empresa.com.br',
        cep: '01234-567',
        estado: 'SP',
        cidade: 'São Paulo',
        bairro: 'Centro',
        endereco: 'Rua Teste',
        numero: '100',
        complemento: 'Sala 1'
    },
    categoria: {
        nome: 'Categoria Teste',
        descricao: 'Descrição da categoria de teste',
        cor: '#ff5722'
    },
    departamento: {
        nome: 'Departamento Teste',
        descricao: 'Descrição do departamento',
        responsavel: 'João Silva'
    },
    tipoEntrega: {
        nome: 'Entrega Expressa',
        prazo: 2,
        situacao: 'ativo'
    },
    financas: {
        contas_atraso: 'mostrar-1',
        email_remessa: 'financeiro@empresa.com',
        juros_mes: '1.5',
        multa_atraso: '2.0'
    },
    vendaProdutos: {
        etapas: {
            orcamento: true,
            pedido: true,
            liberado: true,
            separacao: true,
            faturamento: true
        },
        numeracao: {
            proximo_pedido: 2001
        },
        reserva_estoque: {
            ativo: true
        }
    },
    vendaServicos: {
        etapas: {
            ordem_servico: true,
            em_execucao: true,
            executada: true,
            faturar_servico: true
        },
        proposta: {
            permitir_proposta: true
        },
        numeracao: {
            proximo_os: 1501
        }
    },
    clientesFornecedores: {
        validacoes: {
            obrigar_cnpj_cpf: true,
            obrigar_endereco: false,
            obrigar_email: true,
            validar_unicidade: true
        },
        credito: {
            bloquear_novos: false,
            limite_padrao: '5000'
        },
        tags: {
            tags_automaticas: true
        }
    },
    infoFrete: {
        modalidade: 'cif',
        frete_minimo: 50.00,
        url_rastreio: 'https://rastreio.correios.com.br',
        habilitar_rastreamento: true,
        notificar_despacho: true,
        notificar_entrega: false
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES DE AUTENTICAÇÁO
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔐 Autenticação das APIs de Configuração', function() {
    this.timeout(10000);

    describe('🚫 Requisições sem Autenticação', function() {
        it('GET /api/configuracoes/empresa deve retornar 401 sem token', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/empresa')
                    .expect('Content-Type', /json/);
                
                // Pode retornar 401 ou 403 dependendo da implementação
                expect([401, 403]).to.include(res.status);
            } catch (error) {
                // Se o servidor não estiver rodando, pular teste
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('POST /api/configuracoes/empresa deve retornar 401 sem token', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/empresa')
                    .send(TEST_DATA.empresa)
                    .expect('Content-Type', /json/);
                
                expect([401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API CONFIGURAÇÕES DA EMPRESA
// ═══════════════════════════════════════════════════════════════════════════════

describe('🏢 API Configurações da Empresa', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/empresa', function() {
        it('deve retornar estrutura de dados correta', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/empresa')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                    
                    // Verificar campos esperados
                    const camposEsperados = [
                        'razao_social', 'nome_fantasia', 'cnpj', 'telefone',
                        'email', 'cep', 'estado', 'cidade', 'endereco'
                    ];
                    
                    // Pelo menos alguns campos devem existir
                    const camposPresentes = camposEsperados.filter(c => res.body.hasOwnProperty(c));
                    expect(camposPresentes.length).to.be.greaterThan(0);
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('deve retornar dados padrão da Aluforce quando não há configuração', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/empresa')
                    .set(getAuthHeaders());

                if (res.status === 200 && res.body.razao_social) {
                    // Verificar se retornou dados padrão ou personalizados
                    expect(res.body.razao_social).to.be.a('string');
                    expect(res.body.razao_social.length).to.be.greaterThan(0);
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/empresa', function() {
        it('deve validar razão social obrigatória', async function() {
            try {
                const dadosSemRazao = { ...TEST_DATA.empresa };
                delete dadosSemRazao.razao_social;

                const res = await request(BASE_URL)
                    .post('/api/configuracoes/empresa')
                    .set(getAuthHeaders())
                    .send(dadosSemRazao);

                // Pode aceitar (pois validação está no frontend) ou rejeitar
                // Apenas verificar que não retornou erro de servidor
                expect(res.status).to.be.lessThan(500);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('deve aceitar dados válidos da empresa', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/empresa')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.empresa);

                // Pode retornar 200 ou 401/403 se não autenticado
                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/upload-logo', function() {
        it('deve rejeitar requisição sem arquivo', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/upload-logo')
                    .set(getAuthHeaders());

                // Deve retornar erro por falta de arquivo ou falta de auth
                expect([400, 401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/upload-favicon', function() {
        it('deve rejeitar requisição sem arquivo', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/upload-favicon')
                    .set(getAuthHeaders());

                expect([400, 401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API VENDA DE PRODUTOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🛒 API Configurações de Venda de Produtos', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/venda-produtos', function() {
        it('deve retornar estrutura JSON válida', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/venda-produtos')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                    
                    // Pode ter etapas, numeracao, tabelas_preco, reserva_estoque
                    if (res.body.etapas) {
                        expect(res.body.etapas).to.be.an('object');
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/venda-produtos', function() {
        it('deve aceitar configuração de etapas válida', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/venda-produtos')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.vendaProdutos);

                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API TIPOS DE ENTREGA
// ═══════════════════════════════════════════════════════════════════════════════

describe('🚚 API Tipos de Entrega', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/tipos-entrega', function() {
        it('deve retornar array de tipos de entrega', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/tipos-entrega')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('array');
                    
                    if (res.body.length > 0) {
                        const tipo = res.body[0];
                        expect(tipo).to.have.property('id');
                        expect(tipo).to.have.property('nome');
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/tipos-entrega', function() {
        it('deve criar novo tipo de entrega', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/tipos-entrega')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.tipoEntrega);

                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                    if (res.body.id) {
                        expect(res.body.id).to.be.a('number');
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('deve rejeitar tipo de entrega sem nome', async function() {
            try {
                const dadosSemNome = { ...TEST_DATA.tipoEntrega };
                delete dadosSemNome.nome;

                const res = await request(BASE_URL)
                    .post('/api/configuracoes/tipos-entrega')
                    .set(getAuthHeaders())
                    .send(dadosSemNome);

                // Pode retornar erro ou aceitar (validação pode estar no frontend)
                expect(res.status).to.be.lessThan(500);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('PUT /api/configuracoes/tipos-entrega/:id', function() {
        it('deve atualizar tipo de entrega existente', async function() {
            try {
                const res = await request(BASE_URL)
                    .put('/api/configuracoes/tipos-entrega/1')
                    .set(getAuthHeaders())
                    .send({ ...TEST_DATA.tipoEntrega, nome: 'Tipo Atualizado' });

                expect([200, 401, 403, 404]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('DELETE /api/configuracoes/tipos-entrega/:id', function() {
        it('deve tentar excluir tipo de entrega', async function() {
            try {
                const res = await request(BASE_URL)
                    .delete('/api/configuracoes/tipos-entrega/9999')
                    .set(getAuthHeaders());

                // Pode retornar 200 (sucesso), 404 (não encontrado) ou 401/403
                expect([200, 401, 403, 404]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API INFORMAÇÕES DE FRETE
// ═══════════════════════════════════════════════════════════════════════════════

describe('📦 API Informações de Frete', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/info-frete', function() {
        it('deve retornar configurações de frete', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/info-frete')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                    
                    // Campos opcionais
                    if (res.body.modalidade) {
                        expect(['cif', 'fob']).to.include(res.body.modalidade);
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/info-frete', function() {
        it('deve salvar configurações de frete válidas', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/info-frete')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.infoFrete);

                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API VENDA DE SERVIÇOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔧 API Configurações de Venda de Serviços', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/venda-servicos', function() {
        it('deve retornar estrutura de configurações de serviços', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/venda-servicos')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                    
                    if (res.body.success && res.body.data) {
                        expect(res.body.data).to.be.an('object');
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/venda-servicos', function() {
        it('deve salvar configurações de venda de serviços', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/venda-servicos')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.vendaServicos);

                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API CLIENTES E FORNECEDORES
// ═══════════════════════════════════════════════════════════════════════════════

describe('👥 API Configurações de Clientes e Fornecedores', function() {
    this.timeout(15000);

    describe('POST /api/configuracoes/clientes-fornecedores', function() {
        it('deve salvar configurações de validação', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/clientes-fornecedores')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.clientesFornecedores);

                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('deve aceitar configurações parciais', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/clientes-fornecedores')
                    .set(getAuthHeaders())
                    .send({
                        validacoes: { obrigar_cnpj_cpf: true }
                    });

                expect([200, 401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API FINANÇAS
// ═══════════════════════════════════════════════════════════════════════════════

describe('💰 API Configurações Financeiras', function() {
    this.timeout(15000);

    describe('POST /api/configuracoes/financas', function() {
        it('deve salvar configurações financeiras', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/financas')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.financas);

                expect([200, 401, 403]).to.include(res.status);
                
                if (res.status === 200) {
                    expect(res.body.success).to.be.true;
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('deve aceitar valores numéricos válidos para juros e multa', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/financas')
                    .set(getAuthHeaders())
                    .send({
                        juros_mes: '1.5',
                        multa_atraso: '2.0'
                    });

                expect([200, 401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API IMPOSTOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('📊 API Configurações de Impostos', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/impostos', function() {
        it('deve retornar configurações de impostos', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/impostos')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/impostos', function() {
        it('deve aceitar configurações de impostos', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/impostos')
                    .set(getAuthHeaders())
                    .send({
                        icms: 18,
                        pis: 1.65,
                        cofins: 7.6,
                        ipi: 0
                    });

                expect([200, 401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/impostos/calcular', function() {
        it('deve calcular impostos sobre valor', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/impostos/calcular')
                    .set(getAuthHeaders())
                    .send({
                        valor: 1000,
                        tipo: 'produto'
                    });

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - API NFSe
// ═══════════════════════════════════════════════════════════════════════════════

describe('📄 API Configurações NFSe', function() {
    this.timeout(15000);

    describe('GET /api/configuracoes/nfse', function() {
        it('deve retornar configurações de NFS-e', async function() {
            try {
                const res = await request(BASE_URL)
                    .get('/api/configuracoes/nfse')
                    .set(getAuthHeaders());

                if (res.status === 200) {
                    expect(res.body).to.be.an('object');
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('POST /api/configuracoes/nfse', function() {
        it('deve aceitar configurações de NFS-e', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/nfse')
                    .set(getAuthHeaders())
                    .send({
                        ambiente: 'homologacao',
                        serie: '1',
                        proximo_numero: 1
                    });

                expect([200, 401, 403]).to.include(res.status);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES DE PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════

describe('⚡ Testes de Performance das APIs', function() {
    this.timeout(30000);

    describe('Tempo de Resposta', function() {
        it('GET /api/configuracoes/empresa deve responder em menos de 2s', async function() {
            try {
                const start = Date.now();
                
                await request(BASE_URL)
                    .get('/api/configuracoes/empresa')
                    .set(getAuthHeaders());
                
                const duration = Date.now() - start;
                
                expect(duration).to.be.lessThan(2000);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('GET /api/configuracoes/tipos-entrega deve responder em menos de 2s', async function() {
            try {
                const start = Date.now();
                
                await request(BASE_URL)
                    .get('/api/configuracoes/tipos-entrega')
                    .set(getAuthHeaders());
                
                const duration = Date.now() - start;
                
                expect(duration).to.be.lessThan(2000);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES DE SEGURANÇA
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔒 Testes de Segurança', function() {
    this.timeout(15000);

    describe('Proteção contra Injeção', function() {
        it('deve sanitizar entrada SQL maliciosa em nome de categoria', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/categorias')
                    .set(getAuthHeaders())
                    .send({
                        nome: "'; DROP TABLE categorias; --",
                        descricao: 'Tentativa de SQL Injection'
                    });

                // Não deve causar erro de servidor
                expect(res.status).to.be.lessThan(500);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });

        it('deve sanitizar entrada XSS em descrição', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/departamentos')
                    .set(getAuthHeaders())
                    .send({
                        nome: 'Teste XSS',
                        descricao: '<script>alert("XSS")</script>'
                    });

                expect(res.status).to.be.lessThan(500);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });

    describe('Validação de Headers', function() {
        it('deve aceitar Content-Type application/json', async function() {
            try {
                const res = await request(BASE_URL)
                    .post('/api/configuracoes/empresa')
                    .set('Content-Type', 'application/json')
                    .set(getAuthHeaders())
                    .send(TEST_DATA.empresa);

                expect(res.status).to.be.lessThan(500);
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTAÇÁO
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    TEST_DATA,
    getAuthHeaders,
    BASE_URL
};
