/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALUFORCE ERP - FIXTURES DE TESTE - MODAL DE CONFIGURAÇÕES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Dados de teste padronizados para uso em testes unitários, integração e E2E.
 * 
 * @author QA Automation
 * @version 1.0.0
 * @date 2025-01-18
 */

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - EMPRESA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dados válidos de empresa para testes
 */
const EMPRESA_VALIDA = {
    razao_social: 'EMPRESA TESTE LTDA',
    nome_fantasia: 'EMPRESA TESTE',
    cnpj: '12.345.678/0001-90',
    inscricao_estadual: '123456789012',
    inscricao_municipal: '98765432',
    telefone: '(11) 99999-9999',
    email: 'contato@empresa-teste.com.br',
    site: 'https://empresa-teste.com.br',
    cep: '01234-567',
    estado: 'SP',
    cidade: 'São Paulo',
    bairro: 'Centro',
    endereco: 'Rua Teste',
    numero: '100',
    complemento: 'Sala 1'
};

/**
 * Dados da Aluforce (padrão do sistema)
 */
const EMPRESA_ALUFORCE = {
    razao_social: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
    nome_fantasia: 'ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES ELETRICOS',
    cnpj: '68.192.475/0001-60',
    telefone: '(11) 91793-9089',
    cep: '08537-400',
    estado: 'SP',
    cidade: 'Ferraz de Vasconcelos (SP)',
    bairro: 'VILA SãO JOãO',
    endereco: 'RUA ERNESTINA',
    numero: '270',
    complemento: ''
};

/**
 * Dados inválidos de empresa para testes negativos
 */
const EMPRESA_INVALIDA = {
    razao_social: '', // Obrigatório
    cnpj: '123', // Formato inválido
    email: 'email-invalido', // Email inválido
    cep: 'abc' // CEP inválido
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - CATEGORIAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista de categorias válidas
 */
const CATEGORIAS_VALIDAS = [
    {
        id: 1,
        nome: 'Materiais Elétricos',
        descricao: 'Cabos, fios e condutores elétricos',
        cor: '#f97316'
    },
    {
        id: 2,
        nome: 'Equipamentos',
        descricao: 'Equipamentos de proteção e medição',
        cor: '#22c55e'
    },
    {
        id: 3,
        nome: 'Serviços',
        descricao: 'Serviços técnicos especializados',
        cor: '#3b82f6'
    },
    {
        id: 4,
        nome: 'Consumíveis',
        descricao: 'Materiais de consumo',
        cor: '#8b5cf6'
    }
];

/**
 * Categoria para criação em testes
 */
const CATEGORIA_NOVA = {
    nome: 'Nova Categoria Teste',
    descricao: 'Categoria criada durante testes automatizados',
    cor: '#ec4899'
};

/**
 * Categoria inválida (sem nome)
 */
const CATEGORIA_INVALIDA = {
    nome: '',
    descricao: 'Categoria sem nome',
    cor: '#000000'
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - DEPARTAMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista de departamentos válidos
 */
const DEPARTAMENTOS_VALIDOS = [
    {
        id: 1,
        nome: 'Comercial',
        descricao: 'Departamento de vendas e relacionamento',
        responsavel: 'João Silva'
    },
    {
        id: 2,
        nome: 'Produção',
        descricao: 'Departamento de produção industrial',
        responsavel: 'Maria Santos'
    },
    {
        id: 3,
        nome: 'Financeiro',
        descricao: 'Departamento financeiro e contábil',
        responsavel: 'Carlos Oliveira'
    },
    {
        id: 4,
        nome: 'RH',
        descricao: 'Recursos Humanos',
        responsavel: 'Ana Costa'
    },
    {
        id: 5,
        nome: 'TI',
        descricao: 'Tecnologia da Informação',
        responsavel: 'Pedro Lima'
    }
];

/**
 * Departamento para criação em testes
 */
const DEPARTAMENTO_NOVO = {
    nome: 'Novo Departamento',
    descricao: 'Departamento de teste',
    responsavel: 'Usuário Teste'
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - TIPOS DE ENTREGA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista de tipos de entrega válidos
 */
const TIPOS_ENTREGA_VALIDOS = [
    {
        id: 1,
        nome: 'Sedex',
        prazo: 3,
        situacao: 'ativo',
        transportadora_id: 1,
        transportadora_nome: 'Correios'
    },
    {
        id: 2,
        nome: 'PAC',
        prazo: 10,
        situacao: 'ativo',
        transportadora_id: 1,
        transportadora_nome: 'Correios'
    },
    {
        id: 3,
        nome: 'Transportadora',
        prazo: 5,
        situacao: 'ativo',
        transportadora_id: 2,
        transportadora_nome: 'Jadlog'
    },
    {
        id: 4,
        nome: 'Retirada',
        prazo: 0,
        situacao: 'ativo',
        transportadora_id: null,
        transportadora_nome: null
    }
];

/**
 * Tipo de entrega para criação em testes
 */
const TIPO_ENTREGA_NOVO = {
    nome: 'Entrega Expressa Teste',
    prazo: 1,
    situacao: 'ativo',
    transportadora_id: null
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - CONFIGURAÇÕES FINANCEIRAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configurações financeiras padrão
 */
const CONFIG_FINANCAS_PADRAO = {
    contas_atraso: 'nao-mostrar',
    email_remessa: '',
    juros_mes: '1.0',
    multa_atraso: '2.0'
};

/**
 * Configurações financeiras personalizadas
 */
const CONFIG_FINANCAS_CUSTOM = {
    contas_atraso: 'mostrar-1',
    email_remessa: 'financeiro@empresa.com.br',
    juros_mes: '1.5',
    multa_atraso: '2.5'
};

/**
 * Configurações financeiras inválidas
 */
const CONFIG_FINANCAS_INVALIDA = {
    juros_mes: 'abc', // Deve ser número
    multa_atraso: '-5' // Não pode ser negativo
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - VENDA DE PRODUTOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configurações de venda de produtos padrão
 */
const CONFIG_VENDA_PRODUTOS_PADRAO = {
    etapas: {
        orcamento: true,
        pedido: true,
        liberado: true,
        separacao: true,
        faturamento: true
    },
    tabelas_preco: {
        usar_tabelas: true,
        tabela_padrao: 1
    },
    numeracao: {
        proximo_pedido: 1001
    },
    reserva_estoque: {
        ativo: true,
        reservar_no_orcamento: false
    }
};

/**
 * Configurações de venda de produtos mínimas
 */
const CONFIG_VENDA_PRODUTOS_MINIMA = {
    etapas: {
        orcamento: false,
        pedido: true,
        liberado: false,
        separacao: false,
        faturamento: true
    },
    numeracao: {
        proximo_pedido: 5000
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - VENDA DE SERVIÇOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configurações de venda de serviços padrão
 */
const CONFIG_VENDA_SERVICOS_PADRAO = {
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
        proximo_os: 1001
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - CLIENTES E FORNECEDORES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configurações de clientes/fornecedores padrão
 */
const CONFIG_CLIENTES_FORNECEDORES_PADRAO = {
    validacoes: {
        obrigar_cnpj_cpf: false,
        obrigar_endereco: false,
        obrigar_email: false,
        validar_unicidade: true
    },
    credito: {
        bloquear_novos: false,
        limite_padrao: '0'
    },
    tags: {
        tags_automaticas: false
    }
};

/**
 * Configurações restritivas
 */
const CONFIG_CLIENTES_FORNECEDORES_RESTRITIVA = {
    validacoes: {
        obrigar_cnpj_cpf: true,
        obrigar_endereco: true,
        obrigar_email: true,
        validar_unicidade: true
    },
    credito: {
        bloquear_novos: true,
        limite_padrao: '5000'
    },
    tags: {
        tags_automaticas: true
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - INFORMAÇÕES DE FRETE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configurações de frete padrão
 */
const CONFIG_FRETE_PADRAO = {
    modalidade: 'cif',
    frete_minimo: 0,
    url_rastreio: '',
    habilitar_rastreamento: false,
    notificar_despacho: false,
    notificar_entrega: false
};

/**
 * Configurações de frete completas
 */
const CONFIG_FRETE_COMPLETA = {
    modalidade: 'fob',
    frete_minimo: 50.00,
    url_rastreio: 'https://rastreio.correios.com.br/objeto/{codigo}',
    habilitar_rastreamento: true,
    notificar_despacho: true,
    notificar_entrega: true
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - IMPOSTOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configurações de impostos padrão (Simples Nacional)
 */
const CONFIG_IMPOSTOS_SIMPLES = {
    regime: 'simples',
    icms: 0,
    pis: 0,
    cofins: 0,
    ipi: 0,
    aliquota_simples: 4.0
};

/**
 * Configurações de impostos (Lucro Presumido)
 */
const CONFIG_IMPOSTOS_PRESUMIDO = {
    regime: 'presumido',
    icms: 18,
    pis: 0.65,
    cofins: 3.0,
    ipi: 5,
    irpj: 15,
    csll: 9
};

/**
 * Configurações de impostos (Lucro Real)
 */
const CONFIG_IMPOSTOS_REAL = {
    regime: 'real',
    icms: 18,
    pis: 1.65,
    cofins: 7.6,
    ipi: 5,
    irpj: 15,
    csll: 9
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - USUÁRIOS DE TESTE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Usuário administrador para testes
 */
const USUARIO_ADMIN = {
    id: 1,
    nome: 'Administrador Teste',
    email: 'admin@teste.com',
    password: 'Admin@123',
    nivel: 'Administrador',
    ativo: true
};

/**
 * Usuário comum para testes
 */
const USUARIO_COMUM = {
    id: 2,
    nome: 'Usuário Teste',
    email: 'usuario@teste.com',
    password: 'Usuario@123',
    nivel: 'Usuário',
    ativo: true
};

/**
 * Usuário sem permissão para configurações
 */
const USUARIO_SEM_PERMISSAO = {
    id: 3,
    nome: 'Sem Permissão',
    email: 'noperm@teste.com',
    password: 'NoPerm@123',
    nivel: 'Visualizador',
    ativo: true
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - RESPOSTAS DE API (MOCKS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resposta de sucesso padrão
 */
const API_RESPONSE_SUCCESS = {
    success: true,
    message: 'Operação realizada com sucesso'
};

/**
 * Resposta de erro padrão
 */
const API_RESPONSE_ERROR = {
    success: false,
    error: 'Erro ao processar requisição',
    message: 'Ocorreu um erro interno'
};

/**
 * Resposta de erro de autenticação
 */
const API_RESPONSE_AUTH_ERROR = {
    success: false,
    error: 'Não autorizado',
    message: 'Token de autenticação inválido ou expirado'
};

/**
 * Resposta de erro de validação
 */
const API_RESPONSE_VALIDATION_ERROR = {
    success: false,
    error: 'Erro de validação',
    message: 'Campos obrigatórios não preenchidos',
    fields: ['razao_social']
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES - CENÁRIOS DE TESTE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cenários de teste para empresa
 */
const CENARIOS_EMPRESA = {
    criar_nova: {
        descricao: 'Criar nova configuração de empresa',
        dados: EMPRESA_VALIDA,
        resultado_esperado: 'success'
    },
    atualizar_existente: {
        descricao: 'Atualizar empresa existente',
        dados: { ...EMPRESA_VALIDA, nome_fantasia: 'Nome Atualizado' },
        resultado_esperado: 'success'
    },
    validar_campo_obrigatorio: {
        descricao: 'Validar campo razão social obrigatório',
        dados: EMPRESA_INVALIDA,
        resultado_esperado: 'error'
    }
};

/**
 * Cenários de teste para categorias
 */
const CENARIOS_CATEGORIAS = {
    listar_todas: {
        descricao: 'Listar todas as categorias',
        resultado_esperado: CATEGORIAS_VALIDAS
    },
    criar_nova: {
        descricao: 'Criar nova categoria',
        dados: CATEGORIA_NOVA,
        resultado_esperado: 'success'
    },
    editar_existente: {
        descricao: 'Editar categoria existente',
        id: 1,
        dados: { nome: 'Categoria Editada', cor: '#ff0000' },
        resultado_esperado: 'success'
    },
    excluir: {
        descricao: 'Excluir categoria',
        id: 4,
        resultado_esperado: 'success'
    },
    validar_nome_obrigatorio: {
        descricao: 'Validar nome obrigatório',
        dados: CATEGORIA_INVALIDA,
        resultado_esperado: 'error'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gera ID único para testes
 */
function generateTestId() {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Gera dados de empresa aleatórios
 */
function generateRandomEmpresa() {
    const id = generateTestId();
    return {
        ...EMPRESA_VALIDA,
        razao_social: `EMPRESA ${id.toUpperCase()}`,
        nome_fantasia: `TESTE ${id}`,
        email: `contato_${id}@teste.com`
    };
}

/**
 * Gera dados de categoria aleatórios
 */
function generateRandomCategoria() {
    const id = generateTestId();
    const cores = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
    return {
        nome: `Categoria ${id}`,
        descricao: `Descrição para categoria ${id}`,
        cor: cores[Math.floor(Math.random() * cores.length)]
    };
}

/**
 * Gera dados de departamento aleatórios
 */
function generateRandomDepartamento() {
    const id = generateTestId();
    return {
        nome: `Departamento ${id}`,
        descricao: `Descrição do departamento ${id}`,
        responsavel: `Responsável ${id}`
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTAÇÁO
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Empresa
    EMPRESA_VALIDA,
    EMPRESA_ALUFORCE,
    EMPRESA_INVALIDA,
    
    // Categorias
    CATEGORIAS_VALIDAS,
    CATEGORIA_NOVA,
    CATEGORIA_INVALIDA,
    
    // Departamentos
    DEPARTAMENTOS_VALIDOS,
    DEPARTAMENTO_NOVO,
    
    // Tipos de Entrega
    TIPOS_ENTREGA_VALIDOS,
    TIPO_ENTREGA_NOVO,
    
    // Finanças
    CONFIG_FINANCAS_PADRAO,
    CONFIG_FINANCAS_CUSTOM,
    CONFIG_FINANCAS_INVALIDA,
    
    // Venda de Produtos
    CONFIG_VENDA_PRODUTOS_PADRAO,
    CONFIG_VENDA_PRODUTOS_MINIMA,
    
    // Venda de Serviços
    CONFIG_VENDA_SERVICOS_PADRAO,
    
    // Clientes e Fornecedores
    CONFIG_CLIENTES_FORNECEDORES_PADRAO,
    CONFIG_CLIENTES_FORNECEDORES_RESTRITIVA,
    
    // Frete
    CONFIG_FRETE_PADRAO,
    CONFIG_FRETE_COMPLETA,
    
    // Impostos
    CONFIG_IMPOSTOS_SIMPLES,
    CONFIG_IMPOSTOS_PRESUMIDO,
    CONFIG_IMPOSTOS_REAL,
    
    // Usuários
    USUARIO_ADMIN,
    USUARIO_COMUM,
    USUARIO_SEM_PERMISSAO,
    
    // Respostas de API
    API_RESPONSE_SUCCESS,
    API_RESPONSE_ERROR,
    API_RESPONSE_AUTH_ERROR,
    API_RESPONSE_VALIDATION_ERROR,
    
    // Cenários
    CENARIOS_EMPRESA,
    CENARIOS_CATEGORIAS,
    
    // Funções auxiliares
    generateTestId,
    generateRandomEmpresa,
    generateRandomCategoria,
    generateRandomDepartamento
};
