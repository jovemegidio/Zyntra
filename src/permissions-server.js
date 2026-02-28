// ============================================================
// Sistema de Permissões Server-Side - Aluforce V2
// Permissões granulares por módulo e por ação
// ============================================================

// ============================================================
// DEFINIÇÃO DE TODAS AS AÇÕES POSSÍVEIS POR MÓDULO
// ============================================================
const MODULE_ACTIONS = {
    vendas: {
        // Páginas
        'page.kanban': 'Acessar Kanban',
        'page.pedidos': 'Acessar Lista de Pedidos',
        'page.clientes': 'Acessar Clientes',
        'page.empresas': 'Acessar Empresas',
        'page.relatorios': 'Acessar Relatórios',
        'page.metas': 'Acessar Metas',
        'page.comissoes': 'Acessar Comissões',
        'page.leads': 'Acessar Leads/Prospecção',
        'page.estoque': 'Acessar Estoque',
        'page.gestao_vendas': 'Acessar Gestão de Vendas',
        'page.configuracoes': 'Acessar Configurações',
        // Pedidos - CRUD
        'pedido.criar': 'Criar Pedidos',
        'pedido.visualizar': 'Visualizar Pedidos',
        'pedido.editar': 'Editar Pedidos',
        'pedido.excluir': 'Excluir Pedidos',
        'pedido.duplicar': 'Duplicar Pedidos',
        // Pedidos - Status/Kanban
        'pedido.mover_orcamento': 'Mover para Orçamento',
        'pedido.mover_analise': 'Mover para Análise',
        'pedido.mover_analise_credito': 'Mover para Análise de Crédito',
        'pedido.mover_aprovado': 'Mover para Aprovado',
        'pedido.mover_pedido_aprovado': 'Mover para Pedido Aprovado',
        'pedido.mover_faturar': 'Mover para Faturar',
        'pedido.mover_faturado': 'Mover para Faturado',
        'pedido.mover_entregue': 'Mover para Entregue',
        'pedido.mover_recibo': 'Mover para Recibo',
        'pedido.mover_cancelado': 'Mover para Cancelado',
        // Pedidos - Campos financeiros
        'pedido.editar_valor': 'Editar Valor do Pedido',
        'pedido.editar_desconto': 'Editar Desconto',
        'pedido.editar_frete': 'Editar Frete',
        'pedido.editar_parcelas': 'Editar Parcelas',
        // Itens
        'item.criar': 'Adicionar Itens',
        'item.editar': 'Editar Itens',
        'item.excluir': 'Excluir Itens',
        // Empresas
        'empresa.criar': 'Criar Empresas',
        'empresa.editar': 'Editar Empresas',
        'empresa.excluir': 'Excluir Empresas',
        // Clientes
        'cliente.criar': 'Criar Clientes',
        'cliente.editar': 'Editar Clientes',
        'cliente.excluir': 'Excluir Clientes',
        // Metas / Comissões
        'meta.criar': 'Criar Metas',
        'meta.editar': 'Editar Metas',
        'meta.excluir': 'Excluir Metas',
        'comissao.configurar': 'Configurar Comissões',
        // Leads
        'lead.criar': 'Criar Leads',
        'lead.editar': 'Editar Leads',
        'lead.excluir': 'Excluir Leads',
        // Faturamento
        'faturamento.parcial': 'Faturamento Parcial (F9)',
        'faturamento.remessa': 'Remessa de Entrega',
        // Exportar
        'exportar.excel': 'Exportar para Excel',
        'exportar.pdf': 'Exportar para PDF'
    },
    rh: {
        'page.dashboard': 'Acessar Dashboard RH',
        'page.funcionarios': 'Acessar Funcionários',
        'page.ponto': 'Acessar Gestão de Ponto',
        'page.ferias': 'Acessar Férias',
        'page.folha': 'Acessar Folha de Pagamento',
        'page.treinamentos': 'Acessar Treinamentos',
        'page.documentos': 'Acessar Documentos',
        'page.vagas': 'Acessar Vagas',
        'page.beneficios': 'Acessar Benefícios',
        'page.relatorios': 'Acessar Relatórios',
        'page.configuracoes': 'Acessar Configurações',
        'funcionario.criar': 'Cadastrar Funcionários',
        'funcionario.editar': 'Editar Funcionários',
        'funcionario.excluir': 'Excluir/Demitir Funcionários',
        'funcionario.visualizar': 'Visualizar Funcionários',
        'ponto.editar': 'Editar Registros de Ponto',
        'ponto.aprovar': 'Aprovar Ponto',
        'ferias.aprovar': 'Aprovar Férias',
        'ferias.solicitar': 'Solicitar Férias',
        'vt.ajustar': 'Ajustar Vale Transporte',
        'folha.gerar': 'Gerar Folha de Pagamento',
        'folha.visualizar': 'Visualizar Folha',
        'documento.upload': 'Upload de Documentos',
        'treinamento.criar': 'Criar Treinamentos',
        'exportar.excel': 'Exportar para Excel',
        'exportar.pdf': 'Exportar para PDF'
    },
    pcp: {
        'page.dashboard': 'Acessar Dashboard PCP',
        'page.ordens': 'Acessar Ordens de Produção',
        'page.apontamentos': 'Acessar Apontamentos',
        'page.maquinas': 'Acessar Máquinas',
        'page.produtos': 'Acessar Produtos',
        'page.estoque': 'Acessar Estoque',
        'page.qualidade': 'Acessar Qualidade',
        'page.planejamento': 'Acessar Planejamento',
        'page.relatorios': 'Acessar Relatórios',
        'page.configuracoes': 'Acessar Configurações',
        'ordem.criar': 'Criar Ordens de Produção',
        'ordem.editar': 'Editar Ordens',
        'ordem.excluir': 'Excluir Ordens',
        'ordem.iniciar': 'Iniciar Produção',
        'ordem.finalizar': 'Finalizar Produção',
        'apontamento.criar': 'Criar Apontamentos',
        'apontamento.editar': 'Editar Apontamentos',
        'estoque.ajustar': 'Ajustar Estoque',
        'estoque.transferir': 'Transferir Estoque',
        'produto.criar': 'Cadastrar Produtos',
        'produto.editar': 'Editar Produtos',
        'maquina.criar': 'Cadastrar Máquinas',
        'maquina.editar': 'Editar Máquinas',
        'exportar.excel': 'Exportar para Excel'
    },
    financeiro: {
        'page.dashboard': 'Acessar Dashboard Financeiro',
        'page.contas_pagar': 'Acessar Contas a Pagar',
        'page.contas_receber': 'Acessar Contas a Receber',
        'page.fluxo_caixa': 'Acessar Fluxo de Caixa',
        'page.bancos': 'Acessar Bancos',
        'page.conciliacao': 'Acessar Conciliação',
        'page.relatorios': 'Acessar Relatórios',
        'page.configuracoes': 'Acessar Configurações',
        'conta_pagar.criar': 'Criar Contas a Pagar',
        'conta_pagar.editar': 'Editar Contas a Pagar',
        'conta_pagar.excluir': 'Excluir Contas a Pagar',
        'conta_pagar.pagar': 'Realizar Pagamento',
        'conta_receber.criar': 'Criar Contas a Receber',
        'conta_receber.editar': 'Editar Contas a Receber',
        'conta_receber.excluir': 'Excluir Contas a Receber',
        'conta_receber.receber': 'Realizar Recebimento',
        'banco.criar': 'Cadastrar Bancos',
        'banco.editar': 'Editar Bancos',
        'conciliacao.importar': 'Importar OFX',
        'conciliacao.conciliar': 'Conciliar Lançamentos',
        'exportar.excel': 'Exportar para Excel',
        'exportar.pdf': 'Exportar para PDF'
    },
    nfe: {
        'page.dashboard': 'Acessar Dashboard NFe',
        'page.emissao': 'Acessar Emissão',
        'page.consulta': 'Acessar Consulta',
        'page.livro_registro': 'Acessar Livro Registro',
        'page.relatorios': 'Acessar Relatórios',
        'page.configuracoes': 'Acessar Configurações',
        'nfe.emitir': 'Emitir NF-e',
        'nfe.cancelar': 'Cancelar NF-e',
        'nfe.carta_correcao': 'Carta de Correção',
        'nfe.enviar_email': 'Enviar Email NF-e',
        'nfe.download_xml': 'Download XML',
        'nfe.download_pdf': 'Download PDF',
        'exportar.excel': 'Exportar para Excel'
    },
    compras: {
        'page.dashboard': 'Acessar Dashboard Compras',
        'page.fornecedores': 'Acessar Fornecedores',
        'page.pedidos': 'Acessar Pedidos de Compra',
        'page.recebimento': 'Acessar Recebimento',
        'page.relatorios': 'Acessar Relatórios',
        'page.configuracoes': 'Acessar Configurações',
        'fornecedor.criar': 'Cadastrar Fornecedores',
        'fornecedor.editar': 'Editar Fornecedores',
        'fornecedor.excluir': 'Excluir Fornecedores',
        'pedido.criar': 'Criar Pedidos de Compra',
        'pedido.editar': 'Editar Pedidos de Compra',
        'pedido.excluir': 'Excluir Pedidos de Compra',
        'pedido.aprovar': 'Aprovar Pedidos de Compra',
        'recebimento.registrar': 'Registrar Recebimento',
        'exportar.excel': 'Exportar para Excel'
    }
};

// ============================================================
// PERFIS PRÉ-DEFINIDOS (templates de permissão)
// ============================================================
const PERMISSION_PROFILES = {
    'admin_total': {
        label: 'Administrador Total',
        description: 'Acesso completo a todos os módulos e ações',
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true,
        permissions: '*'
    },
    'vendedor': {
        label: 'Vendedor',
        description: 'Criar/editar pedidos próprios, mover até análise de crédito, cadastrar clientes, relatórios/metas/comissões',
        areas: ['vendas', 'rh'],
        rhType: 'area',
        permissions: {
            vendas: [
                'page.kanban', 'page.pedidos', 'page.clientes', 'page.empresas', 'page.leads',
                'page.relatorios', 'page.metas', 'page.comissoes', 'page.estoque',
                'pedido.criar', 'pedido.visualizar', 'pedido.editar', 'pedido.duplicar',
                'pedido.mover_orcamento', 'pedido.mover_analise', 'pedido.mover_analise_credito',
                'pedido.editar_valor', 'pedido.editar_desconto', 'pedido.editar_frete', 'pedido.editar_parcelas',
                'item.criar', 'item.editar', 'item.excluir',
                'empresa.criar', 'empresa.editar',
                'cliente.criar', 'cliente.editar',
                'lead.criar', 'lead.editar',
                'exportar.excel', 'exportar.pdf'
            ],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'supervisor_vendas': {
        label: 'Supervisor de Vendas',
        description: 'Acesso completo ao módulo vendas incluindo aprovações',
        areas: ['vendas', 'rh'],
        rhType: 'area',
        permissions: {
            vendas: [
                'page.kanban', 'page.pedidos', 'page.clientes', 'page.empresas',
                'page.relatorios', 'page.metas', 'page.comissoes', 'page.leads', 'page.configuracoes',
                'page.estoque', 'page.gestao_vendas',
                'pedido.criar', 'pedido.visualizar', 'pedido.editar', 'pedido.excluir', 'pedido.duplicar',
                'pedido.mover_orcamento', 'pedido.mover_analise', 'pedido.mover_analise_credito',
                'pedido.mover_aprovado', 'pedido.mover_pedido_aprovado', 'pedido.mover_faturar',
                'pedido.mover_faturado', 'pedido.mover_entregue', 'pedido.mover_recibo', 'pedido.mover_cancelado',
                'pedido.editar_valor', 'pedido.editar_desconto', 'pedido.editar_frete', 'pedido.editar_parcelas',
                'item.criar', 'item.editar', 'item.excluir',
                'empresa.criar', 'empresa.editar', 'empresa.excluir',
                'cliente.criar', 'cliente.editar', 'cliente.excluir',
                'meta.criar', 'meta.editar', 'meta.excluir',
                'comissao.configurar',
                'lead.criar', 'lead.editar', 'lead.excluir',
                'faturamento.parcial', 'faturamento.remessa',
                'exportar.excel', 'exportar.pdf'
            ],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'faturista': {
        label: 'Faturista / Expedição',
        description: 'Somente Kanban - mover pedidos aprovados para faturar/faturado',
        areas: ['vendas', 'rh'],
        rhType: 'area',
        permissions: {
            vendas: [
                'page.kanban',
                'pedido.visualizar',
                'pedido.mover_faturar', 'pedido.mover_faturado',
                'pedido.mover_entregue', 'pedido.mover_recibo'
            ],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'financeiro_completo': {
        label: 'Financeiro Completo',
        description: 'Acesso completo ao financeiro + vendas/compras/nfe conforme Omie',
        areas: ['financeiro', 'vendas', 'compras', 'nfe', 'rh'],
        rhType: 'area',
        permissions: {
            financeiro: Object.keys(MODULE_ACTIONS.financeiro),
            vendas: [
                'page.kanban', 'page.pedidos', 'page.clientes', 'page.empresas', 'page.relatorios',
                'pedido.visualizar',
                'cliente.criar', 'cliente.editar',
                'empresa.criar', 'empresa.editar',
                'exportar.excel', 'exportar.pdf'
            ],
            compras: [
                'page.dashboard', 'page.fornecedores', 'page.pedidos', 'page.recebimento', 'page.relatorios',
                'fornecedor.criar', 'fornecedor.editar',
                'recebimento.registrar',
                'exportar.excel'
            ],
            nfe: ['page.dashboard', 'page.consulta', 'page.relatorios', 'nfe.download_xml', 'nfe.download_pdf', 'exportar.excel'],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'financeiro_pagar': {
        label: 'Financeiro - Contas a Pagar',
        description: 'Acesso completo a contas a pagar, visualiza vendas/compras/nfe',
        areas: ['financeiro', 'vendas', 'compras', 'nfe', 'rh'],
        rhType: 'area',
        permissions: {
            financeiro: [
                'page.dashboard', 'page.contas_pagar', 'page.fluxo_caixa',
                'page.bancos', 'page.conciliacao', 'page.relatorios',
                'conta_pagar.criar', 'conta_pagar.editar', 'conta_pagar.excluir', 'conta_pagar.pagar',
                'banco.criar', 'banco.editar',
                'conciliacao.importar', 'conciliacao.conciliar',
                'exportar.excel', 'exportar.pdf'
            ],
            // Vendas: visualiza pedidos e cadastra clientes/fornecedores
            vendas: [
                'page.kanban', 'page.pedidos', 'page.clientes', 'page.empresas', 'page.relatorios',
                'pedido.visualizar',
                'cliente.criar', 'cliente.editar',
                'empresa.criar', 'empresa.editar',
                'exportar.excel', 'exportar.pdf'
            ],
            // Compras: visualiza pedidos e NF-e recebida
            compras: [
                'page.dashboard', 'page.fornecedores', 'page.pedidos', 'page.recebimento', 'page.relatorios',
                'fornecedor.criar', 'fornecedor.editar',
                'recebimento.registrar',
                'exportar.excel'
            ],
            // NFe: consulta e download
            nfe: ['page.dashboard', 'page.consulta', 'page.relatorios', 'nfe.download_xml', 'nfe.download_pdf', 'exportar.excel'],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'financeiro_receber': {
        label: 'Financeiro - Contas a Receber',
        description: 'Acesso completo a contas a receber, visualiza vendas/compras/nfe',
        areas: ['financeiro', 'vendas', 'compras', 'nfe', 'rh'],
        rhType: 'area',
        permissions: {
            financeiro: [
                'page.dashboard', 'page.contas_receber', 'page.fluxo_caixa',
                'page.bancos', 'page.conciliacao', 'page.relatorios',
                'conta_receber.criar', 'conta_receber.editar', 'conta_receber.excluir', 'conta_receber.receber',
                'banco.criar', 'banco.editar',
                'conciliacao.importar', 'conciliacao.conciliar',
                'exportar.excel', 'exportar.pdf'
            ],
            vendas: [
                'page.kanban', 'page.pedidos', 'page.clientes', 'page.empresas', 'page.relatorios',
                'pedido.visualizar',
                'cliente.criar', 'cliente.editar',
                'empresa.criar', 'empresa.editar',
                'exportar.excel', 'exportar.pdf'
            ],
            compras: [
                'page.dashboard', 'page.fornecedores', 'page.pedidos', 'page.recebimento', 'page.relatorios',
                'fornecedor.criar', 'fornecedor.editar',
                'recebimento.registrar',
                'exportar.excel'
            ],
            nfe: ['page.dashboard', 'page.consulta', 'page.relatorios', 'nfe.download_xml', 'nfe.download_pdf', 'exportar.excel'],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'producao_operador': {
        label: 'Operador de Produção',
        description: 'Apontamentos e consultas no PCP',
        areas: ['pcp', 'rh'],
        rhType: 'area',
        permissions: {
            pcp: ['page.dashboard', 'page.apontamentos', 'page.maquinas', 'apontamento.criar', 'apontamento.editar'],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'producao_gerente': {
        label: 'Gerente de Produção',
        description: 'Acesso completo ao PCP',
        areas: ['pcp', 'rh'],
        rhType: 'area',
        permissions: { pcp: Object.keys(MODULE_ACTIONS.pcp), rh: ['funcionario.visualizar', 'ferias.solicitar'] }
    },
    'compras_comprador': {
        label: 'Comprador',
        description: 'Criar pedidos de compra e gerenciar fornecedores',
        areas: ['compras', 'rh'],
        rhType: 'area',
        permissions: {
            compras: [
                'page.dashboard', 'page.fornecedores', 'page.pedidos', 'page.recebimento',
                'fornecedor.criar', 'fornecedor.editar',
                'pedido.criar', 'pedido.editar', 'recebimento.registrar', 'exportar.excel'
            ],
            rh: ['funcionario.visualizar', 'ferias.solicitar']
        }
    },
    'rh_admin': {
        label: 'Administrador RH',
        description: 'Acesso completo ao módulo RH',
        areas: ['rh'],
        rhType: 'areaadm',
        permissions: { rh: Object.keys(MODULE_ACTIONS.rh) }
    },
    'funcionario': {
        label: 'Funcionário',
        description: 'Acesso básico - apenas visualizar próprios dados',
        areas: ['rh'],
        rhType: 'area',
        permissions: { rh: ['funcionario.visualizar', 'ferias.solicitar'] }
    },
    'consultoria': {
        label: 'Consultoria',
        description: 'Acesso de consulta a todos os módulos. Cadastra clientes/fornecedores. Não emite notas, não registra/cancela pagamentos.',
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras'],
        rhType: 'area',
        permissions: {
            // VENDAS: Visualiza pedidos/kanban, cadastra clientes/empresas (sem criar pedidos, sem mover status)
            vendas: [
                'page.kanban', 'page.pedidos', 'page.clientes', 'page.empresas',
                'page.relatorios', 'page.metas', 'page.comissoes',
                'pedido.visualizar',
                'cliente.criar', 'cliente.editar',
                'empresa.criar', 'empresa.editar',
                'exportar.excel', 'exportar.pdf'
            ],
            // RH: Somente visualização
            rh: ['page.dashboard', 'page.funcionarios', 'page.relatorios', 'funcionario.visualizar', 'folha.visualizar'],
            // PCP: Visualiza dashboard/ordens/estoque/produtos (sem cadastrar/movimentar)
            pcp: ['page.dashboard', 'page.ordens', 'page.estoque', 'page.produtos', 'page.relatorios', 'exportar.excel'],
            // FINANCEIRO: Visualiza tudo (sem registrar/cancelar pagamentos)
            financeiro: [
                'page.dashboard', 'page.contas_pagar', 'page.contas_receber',
                'page.fluxo_caixa', 'page.bancos', 'page.conciliacao',
                'page.relatorios',
                'exportar.excel', 'exportar.pdf'
            ],
            // NFE: Somente consulta/visualização (sem emitir/cancelar)
            nfe: ['page.dashboard', 'page.consulta', 'page.relatorios', 'nfe.download_xml', 'nfe.download_pdf', 'exportar.excel'],
            // COMPRAS: Visualiza + cadastra fornecedores (sem aprovar pedidos)
            compras: [
                'page.dashboard', 'page.fornecedores', 'page.pedidos',
                'page.recebimento', 'page.relatorios',
                'fornecedor.criar', 'fornecedor.editar',
                'exportar.excel'
            ]
        }
    }
};

// ============================================================
// PERMISSÕES POR USUÁRIO
// ============================================================
const userPermissions = {
    // ============ ADMINISTRAÇÃO / TI ============
    'douglas': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'andreia': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'ti': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'antonio': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'antônio': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'egidio': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'rh': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'fernando': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'junior': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'eldir': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'adm': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'aluforce': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },
    'compras': { areas: ['vendas', 'compras', 'pcp', 'financeiro'], rhType: 'funcionario', isAdmin: false, profile: 'funcionario' },
    'guilherme.bastos': { areas: ['vendas', 'compras', 'pcp', 'financeiro'], rhType: 'funcionario', isAdmin: false, profile: 'funcionario' },

    // ============ CONTAS QA (Gerentes - Full Admin por Módulo) ============
    'qafinanceiro': { areas: ['financeiro', 'vendas', 'compras', 'nfe', 'rh'], rhType: 'areaadm', isAdmin: true, profile: 'financeiro_completo' },
    'qavendas': { areas: ['vendas', 'rh'], rhType: 'areaadm', isAdmin: true, profile: 'supervisor_vendas' },
    'qapcp': { areas: ['pcp', 'rh'], rhType: 'areaadm', isAdmin: true, profile: 'producao_gerente' },
    'qarh': { areas: ['rh'], rhType: 'areaadm', isAdmin: true, profile: 'rh_admin' },
    'qacompras': { areas: ['vendas', 'compras', 'pcp', 'financeiro'], rhType: 'areaadm', isAdmin: true, profile: 'compras_comprador' },
    'qanfe': { areas: ['nfe', 'faturamento', 'rh'], rhType: 'areaadm', isAdmin: true, profile: 'funcionario' },
    'qapainel': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'faturamento', 'ti'], rhType: 'areaadm', isAdmin: true, profile: 'admin_total' },

    // ============ FINANCEIRO / RH ============
    'hellen': { areas: ['financeiro', 'rh'], rhType: 'area', profile: 'funcionario' },
    'tatiane': { areas: ['financeiro', 'rh'], rhType: 'area', profile: 'funcionario' },

    // ============ PRODUÇÃO / VENDAS RESTRITO ============
    'jamesson': {
        areas: ['pcp'],
        rhType: null,
        isAdmin: false,
        profile: null,
        customPermissions: {
            pcp: [
                'page.dashboard',
                'page.ordens',
                'page.apontamentos',
                'page.maquinas',
                'page.produtos',
                'page.estoque',
                'page.qualidade',
                'page.planejamento',
                'page.relatorios',
                'exportar.excel',
                'exportar.pdf'
            ]
        }
    },
    'daniel': {
        areas: ['vendas'],
        rhType: null,
        isAdmin: false,
        profile: null,
        customPermissions: {
            vendas: [
                'page.leads',           // Prospecção
                'page.estoque',         // Estoque
                'page.gestao_vendas',   // Gestão de Vendas
                'page.relatorios',      // Relatórios
                'pedido.visualizar',    // Visualizar pedidos (somente leitura)
                'exportar.excel',
                'exportar.pdf'
            ]
        }
    },

    // ============ TESTE ============
    'teste': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras'], rhType: 'area', profile: 'vendedor' }
};

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function normalizeUserName(userName) {
    if (!userName) return '';
    return userName.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[?]/g, '');
}

function getUserData(userName) {
    if (!userName) return null;
    const userKey = userName.toLowerCase().trim();
    const normalizedKey = normalizeUserName(userName);
    let data = userPermissions[userKey];
    if (!data && normalizedKey !== userKey) data = userPermissions[normalizedKey];
    return data || null;
}

function hasAccess(userName, area, userRole) {
    if (!userName) return false;
    if (userRole === 'admin') return true;
    const userData = getUserData(userName);
    if (!userData) return area === 'rh';
    return userData.areas.includes(area.toLowerCase());
}

// ============================================================
// VERIFICAR PERMISSÃO GRANULAR
// ============================================================
function hasPermission(userName, module, action, userRole) {
    if (!userName || !module || !action) return false;
    if (userRole === 'admin') return true;
    const userData = getUserData(userName);
    if (!userData) return false;
    if (userData.isAdmin === true) return true;
    if (!userData.areas.includes(module.toLowerCase())) return false;

    // 1. Custom permissions (maior prioridade)
    if (userData.customPermissions && userData.customPermissions[module]) {
        return userData.customPermissions[module].includes(action);
    }
    // 2. Profile
    if (userData.profile) {
        const profile = PERMISSION_PROFILES[userData.profile];
        if (profile) {
            if (profile.permissions === '*') return true;
            if (profile.permissions && profile.permissions[module]) {
                return profile.permissions[module].includes(action);
            }
        }
    }
    return false;
}

function getUserModulePermissions(userName, module, userRole) {
    if (!userName || !module) return [];
    if (userRole === 'admin') return MODULE_ACTIONS[module] ? Object.keys(MODULE_ACTIONS[module]) : [];
    const userData = getUserData(userName);
    if (!userData) return [];
    if (userData.isAdmin === true) return MODULE_ACTIONS[module] ? Object.keys(MODULE_ACTIONS[module]) : [];
    if (!userData.areas.includes(module.toLowerCase())) return [];

    if (userData.customPermissions && userData.customPermissions[module]) return userData.customPermissions[module];
    if (userData.profile) {
        const profile = PERMISSION_PROFILES[userData.profile];
        if (profile) {
            if (profile.permissions === '*') return MODULE_ACTIONS[module] ? Object.keys(MODULE_ACTIONS[module]) : [];
            if (profile.permissions && profile.permissions[module]) return profile.permissions[module];
        }
    }
    return [];
}

function getUserAllPermissions(userName, userRole) {
    const result = {};
    for (const mod of ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras']) {
        const perms = getUserModulePermissions(userName, mod, userRole);
        if (perms.length > 0) result[mod] = perms;
    }
    return result;
}

function canMoveToStatus(userName, targetStatus, userRole) {
    if (!userName || !targetStatus) return false;
    const map = {
        'orcamento': 'pedido.mover_orcamento', 'orçamento': 'pedido.mover_orcamento',
        'analise': 'pedido.mover_analise', 'analise-credito': 'pedido.mover_analise_credito',
        'aprovado': 'pedido.mover_aprovado', 'pedido-aprovado': 'pedido.mover_pedido_aprovado',
        'faturar': 'pedido.mover_faturar', 'faturado': 'pedido.mover_faturado',
        'entregue': 'pedido.mover_entregue', 'recibo': 'pedido.mover_recibo',
        'cancelado': 'pedido.mover_cancelado'
    };
    const action = map[targetStatus.toLowerCase()];
    if (!action) return false;
    return hasPermission(userName, 'vendas', action, userRole);
}

function canAccessPage(userName, module, pageName, userRole) {
    return hasPermission(userName, module, 'page.' + pageName, userRole);
}

// ============================================================
// FUNÇÕES RETROCOMPATÍVEIS
// ============================================================
function getRHType(userName) {
    if (!userName) return 'area';
    const userData = getUserData(userName);
    return userData ? userData.rhType : 'area';
}

function getUserAreas(userName) {
    if (!userName) return ['rh'];
    const userData = getUserData(userName);
    return userData ? userData.areas : ['rh'];
}

function isAdmin(userName) {
    if (!userName) return false;
    const userData = getUserData(userName);
    return userData ? userData.isAdmin === true : false;
}

function getFinanceiroPermissoes(userName) {
    if (!userName) return null;
    const userData = getUserData(userName);
    return userData ? userData.financeiroPermissoes || null : null;
}

function getUserProfile(userName) {
    if (!userName) return null;
    const userData = getUserData(userName);
    if (!userData || !userData.profile) return null;
    return { id: userData.profile, ...PERMISSION_PROFILES[userData.profile] };
}

const areaURLs = {
    'vendas': '/Vendas/', 'rh': '/RH/', 'pcp': '/PCP/',
    'financeiro': '/Financeiro/financeiro.html', 'nfe': '/NFe/',
    'compras': '/Compras/', 'ti': '/TI/ti.html'
};

function getAreaURL(area, userName) {
    if (area === 'rh') {
        const rhType = getRHType(userName);
        return rhType === 'areaadm' ? 'RH/areaadm.html' : 'RH/area.html';
    }
    return areaURLs[area] || '#';
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    hasAccess, getRHType, getUserAreas, isAdmin, getAreaURL, getFinanceiroPermissoes, userPermissions,
    hasPermission, canMoveToStatus, canAccessPage, getUserModulePermissions, getUserAllPermissions,
    getUserProfile, getUserData, normalizeUserName,
    MODULE_ACTIONS, PERMISSION_PROFILES
};
