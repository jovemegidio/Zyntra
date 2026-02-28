/**
 * ALUFORCE ERP - Modal Test Fixtures
 * Data fixtures para testes de modais do sistema
 * 
 * @version 2.0
 * @date 2026-01-19
 */

'use strict';

// ============================================================================
// CATÁLOGO COMPLETO DE MODAIS DO SISTEMA
// ============================================================================

const MODAL_CATALOG = {
    // === MODAIS GLOBAIS (public/) ===
    global: {
        configuracoes: {
            id: 'modal-configuracoes',
            type: 'config',
            file: 'public/index.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes', '/api/empresa'],
            description: 'Modal principal de configurações do sistema',
            hasPersistence: true,
            priority: 'critical'
        },
        perfil: {
            id: 'modal-perfil',
            type: 'profile',
            file: 'public/index.html',
            js: 'public/js/profile-modal.js',
            endpoints: ['/api/usuarios/perfil', '/api/me'],
            description: 'Edição de perfil do usuário',
            hasPersistence: true,
            priority: 'high'
        },
        preferencias: {
            id: 'modal-preferencias',
            type: 'settings',
            file: 'public/index.html',
            js: 'public/js/preferences-manager.js',
            endpoints: ['/api/usuarios/preferencias'],
            description: 'Preferências do usuário',
            hasPersistence: true,
            priority: 'medium'
        },
        confirmacao: {
            id: 'confirm-modal-overlay',
            type: 'confirmation',
            file: 'public/js/confirm-modal.js',
            js: 'public/js/confirm-modal.js',
            endpoints: [],
            description: 'Modal de confirmação genérico',
            hasPersistence: false,
            priority: 'critical'
        },
        historicoNotificacoes: {
            id: 'modal-historico-notificacoes',
            type: 'history',
            file: 'public/js/notification-manager.js',
            js: 'public/js/notification-manager.js',
            endpoints: ['/api/notificacoes'],
            description: 'Histórico de notificações',
            hasPersistence: true,
            priority: 'medium'
        }
    },

    // === MODAIS DE CONFIGURAÇÁO DETALHADA ===
    config: {
        empresa: {
            id: 'modal-dados-empresa',
            type: 'form',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/empresa', '/api/empresa'],
            description: 'Dados cadastrais da empresa',
            hasPersistence: true,
            priority: 'critical',
            requiredFields: ['razao_social', 'cnpj']
        },
        categorias: {
            id: 'modal-categorias',
            type: 'crud-list',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/categorias'],
            description: 'Gerenciamento de categorias',
            hasPersistence: true,
            priority: 'high'
        },
        categoriaForm: {
            id: 'modal-categoria-form',
            type: 'form',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/categorias'],
            description: 'Formulário de categoria',
            hasPersistence: true,
            priority: 'high',
            requiredFields: ['nome']
        },
        departamentos: {
            id: 'modal-departamentos',
            type: 'crud-list',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/departamentos'],
            description: 'Gerenciamento de departamentos',
            hasPersistence: true,
            priority: 'high'
        },
        departamentoForm: {
            id: 'modal-departamento-form',
            type: 'form',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/departamentos'],
            description: 'Formulário de departamento',
            hasPersistence: true,
            priority: 'high',
            requiredFields: ['nome']
        },
        projetos: {
            id: 'modal-projetos',
            type: 'crud-list',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/projetos'],
            description: 'Gerenciamento de projetos',
            hasPersistence: true,
            priority: 'medium'
        },
        projetoForm: {
            id: 'modal-projeto-form',
            type: 'form',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/projetos'],
            description: 'Formulário de projeto',
            hasPersistence: true,
            priority: 'medium',
            requiredFields: ['nome']
        },
        certificado: {
            id: 'modal-certificado',
            type: 'upload',
            file: 'public/config-modals.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/certificado'],
            description: 'Upload de certificado digital',
            hasPersistence: true,
            priority: 'critical'
        },
        tiposEntrega: {
            id: 'modal-tipos-entrega',
            type: 'crud-list',
            file: 'public/js/config-modals.js',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/tipos-entrega'],
            description: 'Tipos de entrega',
            hasPersistence: true,
            priority: 'high'
        },
        infoFrete: {
            id: 'modal-info-frete',
            type: 'form',
            file: 'public/js/config-modals.js',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/info-frete'],
            description: 'Informações de frete',
            hasPersistence: true,
            priority: 'medium'
        },
        vendaProdutos: {
            id: 'modal-venda-produtos',
            type: 'form',
            file: 'public/index.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/venda-produtos'],
            description: 'Configurações de venda de produtos',
            hasPersistence: true,
            priority: 'high'
        },
        vendaServicos: {
            id: 'modal-venda-servicos',
            type: 'form',
            file: 'public/index.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/venda-servicos'],
            description: 'Configurações de venda de serviços',
            hasPersistence: true,
            priority: 'high'
        },
        clientesFornecedores: {
            id: 'modal-clientes-fornecedores-config',
            type: 'form',
            file: 'public/index.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/clientes-fornecedores'],
            description: 'Configurações de clientes/fornecedores',
            hasPersistence: true,
            priority: 'high'
        },
        financas: {
            id: 'modal-financas',
            type: 'form',
            file: 'public/index.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/financas'],
            description: 'Configurações financeiras',
            hasPersistence: true,
            priority: 'critical'
        },
        impostos: {
            id: 'modal-impostos',
            type: 'form',
            file: 'public/index.html',
            js: 'public/js/config-modals.js',
            endpoints: ['/api/configuracoes/impostos'],
            description: 'Configurações de impostos',
            hasPersistence: true,
            priority: 'critical'
        }
    },

    // === MODAIS PCP ===
    pcp: {
        novaOrdem: {
            id: 'modal-nova-ordem',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/pcp.js',
            endpoints: ['/api/ordens-producao'],
            description: 'Nova ordem de produção',
            hasPersistence: true,
            priority: 'critical',
            requiredFields: ['cliente', 'produto', 'quantidade']
        },
        visualizarOrdem: {
            id: 'modalOrdemView',
            type: 'view',
            file: 'modules/PCP/ordens-producao.html',
            js: 'modules/PCP/ordens-producao.html',
            endpoints: ['/api/ordens-producao/:id'],
            description: 'Visualizar ordem de produção',
            hasPersistence: false,
            priority: 'high'
        },
        novoProduto: {
            id: 'modal-novo-produto',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/pcp_modern.js',
            endpoints: ['/api/produtos'],
            description: 'Novo produto',
            hasPersistence: true,
            priority: 'critical',
            requiredFields: ['codigo', 'nome']
        },
        editarProduto: {
            id: 'modal-editar-produto',
            type: 'form',
            file: 'modules/PCP/modal-produto-enriquecido.html',
            js: 'modules/PCP/modal-produto-enriquecido.js',
            endpoints: ['/api/produtos/:id'],
            description: 'Editar produto',
            hasPersistence: true,
            priority: 'critical'
        },
        novoMaterial: {
            id: 'modal-material-professional',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/pcp_modern.js',
            endpoints: ['/api/materiais'],
            description: 'Novo material',
            hasPersistence: true,
            priority: 'high',
            requiredFields: ['codigo', 'nome']
        },
        movimentacaoProduto: {
            id: 'modal-movimentacao',
            type: 'operation',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/estoque/movimentar'],
            description: 'Movimentação de estoque',
            hasPersistence: true,
            priority: 'critical'
        },
        movimentacaoMaterial: {
            id: 'modal-movimentacao-material',
            type: 'operation',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/materiais/movimentar'],
            description: 'Movimentação de material',
            hasPersistence: true,
            priority: 'critical'
        },
        selecaoProduto: {
            id: 'modal-selecao-produto',
            type: 'selection',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/produtos'],
            description: 'Seleção de produto',
            hasPersistence: false,
            priority: 'medium'
        },
        selecaoMaterial: {
            id: 'modal-selecao-material',
            type: 'selection',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/materiais'],
            description: 'Seleção de material',
            hasPersistence: false,
            priority: 'medium'
        },
        todosPedidos: {
            id: 'modal-todos-pedidos',
            type: 'list',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/pedidos'],
            description: 'Listagem de todos os pedidos',
            hasPersistence: false,
            priority: 'medium'
        },
        maquina: {
            id: 'modal-maquina',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/maquinas'],
            description: 'Cadastro de máquina',
            hasPersistence: true,
            priority: 'medium'
        },
        diario: {
            id: 'modal-diario',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/diario-producao'],
            description: 'Diário de produção',
            hasPersistence: true,
            priority: 'medium'
        },
        faturamento: {
            id: 'modal-faturamento',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/faturamento'],
            description: 'Novo faturamento',
            hasPersistence: true,
            priority: 'critical'
        },
        ordemCompra: {
            id: 'modal-oc',
            type: 'form',
            file: 'modules/PCP/index.html',
            js: 'modules/PCP/index.html',
            endpoints: ['/api/compras'],
            description: 'Nova ordem de compra',
            hasPersistence: true,
            priority: 'critical'
        }
    },

    // === MODAIS FINANCEIRO ===
    financeiro: {
        banco: {
            id: 'modalBanco',
            type: 'form',
            file: 'modules/Financeiro/bancos.html',
            js: 'modules/Financeiro/contas_bancarias.js',
            endpoints: ['/api/contas-bancarias'],
            description: 'Conta bancária',
            hasPersistence: true,
            priority: 'critical'
        },
        transferencia: {
            id: 'modalTransferencia',
            type: 'operation',
            file: 'modules/Financeiro/bancos.html',
            js: 'modules/Financeiro/contas_bancarias.js',
            endpoints: ['/api/contas-bancarias/transferir'],
            description: 'Transferência entre contas',
            hasPersistence: true,
            priority: 'critical'
        },
        contaReceber: {
            id: 'modalConta',
            type: 'form',
            file: 'modules/Financeiro/contas-receber.html',
            js: 'modules/Financeiro/financeiro.js',
            endpoints: ['/api/contas-receber'],
            description: 'Conta a receber',
            hasPersistence: true,
            priority: 'critical'
        },
        contaPagar: {
            id: 'modalConta',
            type: 'form',
            file: 'modules/Financeiro/contas-pagar.html',
            js: 'modules/Financeiro/financeiro.js',
            endpoints: ['/api/contas-pagar'],
            description: 'Conta a pagar',
            hasPersistence: true,
            priority: 'critical'
        },
        centroCusto: {
            id: 'modal-centro-custo',
            type: 'form',
            file: 'modules/Financeiro/centros-custo.html',
            js: 'modules/Financeiro/centros_custo_categorias.js',
            endpoints: ['/api/centros-custo'],
            description: 'Centro de custo',
            hasPersistence: true,
            priority: 'high'
        }
    },

    // === MODAIS VENDAS ===
    vendas: {
        cliente: {
            id: 'modalCliente',
            type: 'form',
            file: 'modules/Vendas/public/clientes.html',
            js: 'modules/Vendas/public/clientes.html',
            endpoints: ['/api/clientes'],
            description: 'Cadastro de cliente',
            hasPersistence: true,
            priority: 'critical',
            requiredFields: ['nome', 'cpf_cnpj']
        },
        meta: {
            id: 'modalMeta',
            type: 'form',
            file: 'modules/Vendas/public/dashboard-admin.html',
            js: 'modules/Vendas/public/dashboard-admin.html',
            endpoints: ['/api/metas'],
            description: 'Meta de vendas',
            hasPersistence: true,
            priority: 'high'
        },
        comissao: {
            id: 'modalEditarComissao',
            type: 'form',
            file: 'modules/Vendas/public/comissoes.html',
            js: 'modules/Vendas/public/comissoes.html',
            endpoints: ['/api/comissoes'],
            description: 'Edição de comissão',
            hasPersistence: true,
            priority: 'high'
        }
    },

    // === MODAIS RH ===
    rh: {
        funcionario: {
            id: 'modal-funcionario',
            type: 'form',
            file: 'modules/RH/index.html',
            js: 'modules/RH/public/app.js',
            endpoints: ['/api/funcionarios'],
            description: 'Cadastro de funcionário',
            hasPersistence: true,
            priority: 'critical',
            requiredFields: ['nome', 'cpf', 'email']
        },
        detalheFuncionario: {
            id: 'modal-detalhe-funcionario',
            type: 'view',
            file: 'modules/RH/index.html',
            js: 'modules/RH/public/app.js',
            endpoints: ['/api/funcionarios/:id'],
            description: 'Detalhes do funcionário',
            hasPersistence: false,
            priority: 'high'
        },
        importarFuncionarios: {
            id: 'modal-importar-funcionarios',
            type: 'import',
            file: 'modules/RH/index.html',
            js: 'modules/RH/public/app.js',
            endpoints: ['/api/funcionarios/importar'],
            description: 'Importar funcionários',
            hasPersistence: true,
            priority: 'medium'
        },
        holerite: {
            id: 'modal-holerite',
            type: 'form',
            file: 'modules/RH/index.html',
            js: 'modules/RH/public/app.js',
            endpoints: ['/api/holerites'],
            description: 'Holerite',
            hasPersistence: true,
            priority: 'high'
        },
        treinamento: {
            id: 'modalTreinamento',
            type: 'form',
            file: 'modules/RH/index.html',
            js: 'modules/RH/public/app.js',
            endpoints: ['/api/treinamentos'],
            description: 'Treinamento',
            hasPersistence: true,
            priority: 'medium'
        },
        beneficio: {
            id: 'modalBeneficio',
            type: 'form',
            file: 'modules/RH/index.html',
            js: 'modules/RH/public/app.js',
            endpoints: ['/api/beneficios'],
            description: 'Benefício',
            hasPersistence: true,
            priority: 'medium'
        }
    },

    // === MODAIS NFe ===
    nfe: {
        novoNFe: {
            id: 'modalNovoNFe',
            type: 'form',
            file: 'modules/NFe/nfe.html',
            js: 'modules/NFe/nfe.html',
            endpoints: ['/api/nfe'],
            description: 'Nova NF-e',
            hasPersistence: true,
            priority: 'critical'
        },
        novoServico: {
            id: 'modalNovoServico',
            type: 'form',
            file: 'modules/NFe/nfe.html',
            js: 'modules/NFe/nfe.html',
            endpoints: ['/api/servicos'],
            description: 'Novo serviço',
            hasPersistence: true,
            priority: 'high'
        },
        expedicao: {
            id: 'modal-expedicao',
            type: 'form',
            file: 'modules/NFe/logistica.html',
            js: 'modules/NFe/logistica.html',
            endpoints: ['/api/expedicoes'],
            description: 'Nova expedição',
            hasPersistence: true,
            priority: 'high'
        },
        transportadora: {
            id: 'modal-transportadora',
            type: 'form',
            file: 'modules/NFe/logistica.html',
            js: 'modules/NFe/logistica.html',
            endpoints: ['/api/transportadoras'],
            description: 'Cadastro de transportadora',
            hasPersistence: true,
            priority: 'medium'
        }
    }
};

// ============================================================================
// DADOS DE TESTE - FIXTURES
// ============================================================================

const TEST_DATA = {
    // Dados de empresa válidos
    empresaValida: {
        razao_social: 'ALUFORCE INDÚSTRIA E COMÉRCIO LTDA',
        nome_fantasia: 'ALUFORCE',
        cnpj: '12.345.678/0001-90',
        inscricao_estadual: '123456789',
        inscricao_municipal: '987654321',
        endereco: 'Rua da Indústria, 100',
        bairro: 'Centro Industrial',
        cidade: 'São Paulo',
        estado: 'SP',
        cep: '01234-567',
        telefone: '(11) 3456-7890',
        email: 'contato@aluforce.com.br',
        regime_tributario: 'lucro_real'
    },

    // Dados de empresa inválidos
    empresaInvalida: {
        razao_social: '', // Campo obrigatório vazio
        cnpj: '123', // CNPJ inválido
        email: 'email-invalido' // Email mal formatado
    },

    // Dados de categoria
    categoriaValida: {
        nome: 'Perfis de Alumínio',
        descricao: 'Perfis para estruturas metálicas',
        ativo: true
    },

    // Dados de departamento
    departamentoValido: {
        nome: 'Produção',
        sigla: 'PROD',
        responsavel: 'João Silva',
        ativo: true
    },

    // Dados de produto
    produtoValido: {
        codigo: 'PROD001',
        nome: 'Perfil de Alumínio 40x40',
        sku: 'ALU-40X40-001',
        gtin: '7891234567890',
        descricao: 'Perfil de alumínio extrudado 40x40mm',
        unidade_medida: 'UN',
        categoria_id: 1,
        preco_venda: 150.00,
        custo_unitario: 100.00,
        estoque_minimo: 50,
        estoque_atual: 200
    },

    // Dados de material
    materialValido: {
        codigo: 'MAT001',
        nome: 'Barra de Alumínio',
        sku: 'BAR-ALU-001',
        unidade_medida: 'KG',
        custo_unitario: 25.00,
        estoque_minimo: 100,
        estoque_atual: 500,
        fornecedor_padrao: 1
    },

    // Dados de ordem de produção
    ordemProducaoValida: {
        cliente_id: 1,
        produto_id: 1,
        quantidade: 100,
        data_entrega: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        prioridade: 'normal',
        observacoes: 'Pedido urgente'
    },

    // Dados de cliente
    clienteValido: {
        nome: 'Empresa Cliente ABC',
        cpf_cnpj: '98.765.432/0001-21',
        email: 'contato@empresaabc.com.br',
        telefone: '(11) 98765-4321',
        endereco: 'Av. Paulista, 1000',
        cidade: 'São Paulo',
        estado: 'SP',
        cep: '01310-100'
    },

    // Dados de funcionário
    funcionarioValido: {
        nome: 'Maria Santos',
        cpf: '123.456.789-00',
        email: 'maria.santos@aluforce.com.br',
        telefone: '(11) 91234-5678',
        cargo_id: 1,
        departamento_id: 1,
        data_admissao: '2025-01-15',
        salario: 5000.00
    },

    // Dados de conta a pagar
    contaPagarValida: {
        descricao: 'Fornecedor de Alumínio',
        valor: 15000.00,
        data_vencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        fornecedor_id: 1,
        categoria_id: 1,
        centro_custo_id: 1
    },

    // Dados de conta a receber
    contaReceberValida: {
        descricao: 'Venda para Cliente ABC',
        valor: 25000.00,
        data_vencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        cliente_id: 1,
        pedido_id: 1
    },

    // Usuários de teste
    usuarios: {
        admin: {
            email: 'admin@aluforce.com.br',
            senha: 'Admin@123',
            perfil: 'admin',
            permissoes: ['all']
        },
        vendedor: {
            email: 'vendedor@aluforce.com.br',
            senha: 'Vendedor@123',
            perfil: 'vendedor',
            permissoes: ['vendas', 'clientes', 'pedidos']
        },
        producao: {
            email: 'producao@aluforce.com.br',
            senha: 'Producao@123',
            perfil: 'producao',
            permissoes: ['pcp', 'produtos', 'materiais']
        },
        financeiro: {
            email: 'financeiro@aluforce.com.br',
            senha: 'Financeiro@123',
            perfil: 'financeiro',
            permissoes: ['financeiro', 'contas', 'bancos']
        },
        rh: {
            email: 'rh@aluforce.com.br',
            senha: 'RH@123456',
            perfil: 'rh',
            permissoes: ['rh', 'funcionarios', 'folha']
        },
        readonly: {
            email: 'consulta@aluforce.com.br',
            senha: 'Consulta@123',
            perfil: 'consulta',
            permissoes: ['view_only']
        }
    }
};

// ============================================================================
// CENÁRIOS DE TESTE
// ============================================================================

const TEST_SCENARIOS = {
    // Cenários de sucesso
    success: [
        {
            id: 'S001',
            name: 'Abrir e fechar modal de configurações',
            modal: 'modal-configuracoes',
            steps: ['abrir', 'verificar_visibilidade', 'fechar', 'verificar_oculto']
        },
        {
            id: 'S002',
            name: 'Salvar dados da empresa com dados válidos',
            modal: 'modal-dados-empresa',
            steps: ['abrir', 'preencher_formulario', 'salvar', 'verificar_sucesso', 'fechar']
        },
        {
            id: 'S003',
            name: 'Criar nova categoria',
            modal: 'modal-categoria-form',
            steps: ['abrir', 'preencher_nome', 'salvar', 'verificar_lista_atualizada']
        },
        {
            id: 'S004',
            name: 'Criar novo produto com todos os campos',
            modal: 'modal-novo-produto',
            steps: ['abrir', 'preencher_formulario_completo', 'salvar', 'verificar_criacao']
        },
        {
            id: 'S005',
            name: 'Fluxo completo de ordem de produção',
            modal: 'modal-nova-ordem',
            steps: ['abrir', 'selecionar_cliente', 'selecionar_produto', 'definir_quantidade', 'salvar']
        }
    ],

    // Cenários de erro
    error: [
        {
            id: 'E001',
            name: 'Tentar salvar empresa sem razão social',
            modal: 'modal-dados-empresa',
            steps: ['abrir', 'limpar_razao_social', 'salvar', 'verificar_erro_validacao']
        },
        {
            id: 'E002',
            name: 'Tentar criar categoria duplicada',
            modal: 'modal-categoria-form',
            steps: ['abrir', 'preencher_nome_existente', 'salvar', 'verificar_erro_duplicado']
        },
        {
            id: 'E003',
            name: 'Falha de API ao salvar',
            modal: 'modal-dados-empresa',
            steps: ['abrir', 'preencher_formulario', 'simular_erro_api', 'verificar_mensagem_erro']
        },
        {
            id: 'E004',
            name: 'Timeout de requisição',
            modal: 'modal-novo-produto',
            steps: ['abrir', 'preencher_formulario', 'simular_timeout', 'verificar_retry']
        }
    ],

    // Cenários de segurança
    security: [
        {
            id: 'SEC001',
            name: 'Acesso sem autenticação',
            modal: 'modal-configuracoes',
            steps: ['remover_token', 'tentar_abrir', 'verificar_redirect_login']
        },
        {
            id: 'SEC002',
            name: 'Usuário sem permissão para configurações',
            modal: 'modal-configuracoes',
            user: 'vendedor',
            steps: ['login', 'tentar_abrir', 'verificar_acesso_negado']
        },
        {
            id: 'SEC003',
            name: 'Injeção XSS em campo de texto',
            modal: 'modal-categoria-form',
            steps: ['abrir', 'inserir_script_xss', 'salvar', 'verificar_sanitizacao']
        },
        {
            id: 'SEC004',
            name: 'Injeção SQL em campo de busca',
            modal: 'modal-configuracoes',
            steps: ['abrir', 'inserir_sql_injection', 'executar_busca', 'verificar_escape']
        }
    ],

    // Cenários de performance
    performance: [
        {
            id: 'P001',
            name: 'Tempo de abertura do modal < 500ms',
            modal: 'modal-configuracoes',
            threshold: 500,
            metric: 'open_time'
        },
        {
            id: 'P002',
            name: 'Tempo de carregamento de dados < 2s',
            modal: 'modal-dados-empresa',
            threshold: 2000,
            metric: 'data_load_time'
        },
        {
            id: 'P003',
            name: 'Tempo de salvamento < 3s',
            modal: 'modal-dados-empresa',
            threshold: 3000,
            metric: 'save_time'
        }
    ]
};

// ============================================================================
// SELETORES CSS PADRÁO PARA MODAIS
// ============================================================================

const MODAL_SELECTORS = {
    overlay: '.modal-overlay, .config-detail-modal, .confirm-modal-overlay',
    content: '.modal-content, .config-detail-card, .confirm-modal',
    header: '.modal-header, .config-detail-header, .confirm-modal-header',
    body: '.modal-body, .config-detail-body, .confirm-modal-text',
    footer: '.modal-footer, .config-detail-footer, .confirm-modal-footer',
    closeBtn: '.modal-close, .btn-close, [data-dismiss="modal"], .config-btn-secondary',
    confirmBtn: '.btn-primary, .btn-confirm, .config-btn-primary, .confirm-modal-btn-confirm',
    cancelBtn: '.btn-secondary, .btn-cancel, .confirm-modal-btn-cancel',
    form: 'form',
    input: 'input, select, textarea',
    loading: '.loading, .spinner, [data-loading]',
    error: '.error, .error-message, .form-error',
    success: '.success, .success-message'
};

// ============================================================================
// FUNÇÕES AUXILIARES DE TESTE
// ============================================================================

const TEST_HELPERS = {
    /**
     * Gera um ID único para testes
     */
    generateId: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,

    /**
     * Aguarda um tempo específico
     */
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    /**
     * Aguarda um elemento estar visível
     */
    waitForVisible: async (selector, timeout = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) return el;
            await TEST_HELPERS.wait(100);
        }
        throw new Error(`Element ${selector} not visible after ${timeout}ms`);
    },

    /**
     * Aguarda um elemento estar oculto
     */
    waitForHidden: async (selector, timeout = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (!el || el.offsetParent === null) return true;
            await TEST_HELPERS.wait(100);
        }
        throw new Error(`Element ${selector} still visible after ${timeout}ms`);
    },

    /**
     * Limpa o estado do modal
     */
    cleanupModal: (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active', 'open', 'show');
            modal.style.display = 'none';
        }
    },

    /**
     * Simula um clique em um elemento
     */
    click: (selector) => {
        const el = document.querySelector(selector);
        if (el) {
            el.click();
            return true;
        }
        return false;
    },

    /**
     * Preenche um input
     */
    fillInput: (selector, value) => {
        const el = document.querySelector(selector);
        if (el) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }
};

// ============================================================================
// EXPORTAÇÕES
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MODAL_CATALOG,
        TEST_DATA,
        TEST_SCENARIOS,
        MODAL_SELECTORS,
        TEST_HELPERS
    };
}

// Disponibilizar globalmente para testes no navegador
if (typeof window !== 'undefined') {
    window.ALUFORCE_TEST_FIXTURES = {
        MODAL_CATALOG,
        TEST_DATA,
        TEST_SCENARIOS,
        MODAL_SELECTORS,
        TEST_HELPERS
    };
}
