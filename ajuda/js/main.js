// Main JavaScript for Ajuda Aluforce

document.addEventListener('DOMContentLoaded', function() {
    // Search Database - All searchable content
    const searchDatabase = [
        // Coleções
        { title: 'Guia Inicial', description: 'Primeiros passos para começar a usar o Aluforce', url: 'colecoes/guia-inicial.html', keywords: 'início começar configurar setup primeiro' },
        { title: 'Portal', description: 'Conheça o Portal Aluforce e suas funcionalidades', url: 'colecoes/portal.html', keywords: 'portal dashboard painel' },
        { title: 'WhatsApp Business', description: 'Integração do Aluforce com WhatsApp', url: 'colecoes/whatsapp.html', keywords: 'whatsapp mensagem chat integração' },
        { title: 'Novidades', description: 'Últimas atualizações e novos recursos', url: 'colecoes/novidades.html', keywords: 'novo atualização release versão' },
        { title: 'Segurança', description: 'Proteção e privacidade dos seus dados', url: 'colecoes/seguranca.html', keywords: 'segurança senha login proteção privacidade' },
        { title: 'App Mobile', description: 'Aplicativo Aluforce para celular', url: 'colecoes/app.html', keywords: 'app aplicativo celular mobile android ios' },
        { title: 'Cenários', description: 'Exemplos práticos para seu dia a dia', url: 'colecoes/cenarios.html', keywords: 'exemplo prático cenário caso' },
        { title: 'Cadastros', description: 'Clientes, fornecedores, produtos e serviços', url: 'colecoes/cadastros.html', keywords: 'cadastro cliente fornecedor produto serviço' },
        { title: 'Vendas', description: 'Módulo completo de vendas e pedidos', url: 'colecoes/vendas.html', keywords: 'venda pedido orçamento cliente' },
        { title: 'Compras', description: 'Gestão de compras e fornecedores', url: 'colecoes/compras.html', keywords: 'compra fornecedor pedido cotação' },
        { title: 'Finanças', description: 'Contas a pagar, receber e fluxo de caixa', url: 'colecoes/financas.html', keywords: 'financeiro pagar receber caixa banco boleto' },
        { title: 'Estoque', description: 'Controle de estoque e inventário', url: 'colecoes/estoque.html', keywords: 'estoque inventário produto quantidade' },
        { title: 'Notas Fiscais', description: 'Emissão e gestão de documentos fiscais', url: 'colecoes/notas-fiscais.html', keywords: 'nota fiscal nfe nfse documento' },
        { title: 'Contabilidade', description: 'Integração contábil e relatórios', url: 'colecoes/contabilidade.html', keywords: 'contábil contabilidade sped fiscal' },
        { title: 'Relatórios', description: 'Análises e dashboards gerenciais', url: 'colecoes/relatorios.html', keywords: 'relatório dashboard análise gráfico' },
        
        // Artigos - Guia Inicial
        { title: 'Primeiro Acesso', description: 'Como fazer seu primeiro login no sistema', url: 'artigos/primeiro-acesso.html', keywords: 'login acesso senha primeiro entrar autenticação' },
        { title: 'Configurações Iniciais', description: 'Configure os dados básicos da sua empresa', url: 'artigos/configuracoes-iniciais.html', keywords: 'configuração empresa dados cadastro inicial cnpj razão social' },
        { title: 'Configurações por Segmento', description: 'Ajustes específicos para seu tipo de empresa', url: 'artigos/configuracoes-segmento.html', keywords: 'segmento comércio serviço indústria tipo empresa' },
        
        // Artigos - Cadastros
        { title: 'Cadastro de Clientes', description: 'Como cadastrar e gerenciar clientes', url: 'artigos/cadastro-clientes.html', keywords: 'cliente cadastro pessoa física jurídica cpf cnpj contato' },
        { title: 'Cadastro de Fornecedores', description: 'Como cadastrar e gerenciar fornecedores', url: 'artigos/cadastro-fornecedores.html', keywords: 'fornecedor cadastro parceiro compra cnpj' },
        { title: 'Cadastro de Produtos', description: 'Como cadastrar produtos e serviços', url: 'artigos/cadastro-produtos.html', keywords: 'produto serviço cadastro sku código barras ncm preço' },
        
        // Artigos - Vendas
        { title: 'Criar Pedido de Venda', description: 'Passo a passo para criar pedidos', url: 'artigos/criar-pedido-venda.html', keywords: 'pedido venda orçamento proposta comercial cliente' },
        { title: 'Faturar Pedido', description: 'Como faturar pedidos de venda', url: 'artigos/faturar-pedido.html', keywords: 'faturar faturamento pedido nota fiscal venda' },
        { title: 'Tabela de Preços', description: 'Configurar tabelas de preços', url: 'artigos/tabela-precos.html', keywords: 'preço tabela markup margem desconto promoção' },
        
        // Artigos - Compras
        { title: 'Criar Pedido de Compra', description: 'Como fazer pedidos a fornecedores', url: 'artigos/criar-pedido-compra.html', keywords: 'compra pedido fornecedor cotação ordem' },
        { title: 'Entrada de NF-e', description: 'Importar e lançar notas de entrada', url: 'artigos/entrada-nfe.html', keywords: 'entrada nota fiscal nfe xml importar compra' },
        
        // Artigos - Finanças
        { title: 'Contas a Pagar', description: 'Gerenciar contas e pagamentos', url: 'artigos/contas-pagar.html', keywords: 'pagar conta despesa boleto pagamento vencimento' },
        { title: 'Contas a Receber', description: 'Gerenciar recebimentos e cobranças', url: 'artigos/contas-receber.html', keywords: 'receber conta receita cobrança boleto pix' },
        { title: 'Fluxo de Caixa', description: 'Controle de entradas e saídas', url: 'artigos/fluxo-caixa.html', keywords: 'fluxo caixa entrada saída saldo movimento' },
        { title: 'Conciliação Bancária', description: 'Conciliar extratos com lançamentos', url: 'artigos/conciliacao-bancaria.html', keywords: 'banco conciliação extrato ofx conferência' },
        { title: 'Desconto de Duplicatas', description: 'Como registrar desconto de duplicatas', url: 'artigos/desconto-duplicatas.html', keywords: 'desconto duplicata antecipação financeiro' },
        
        // Artigos - Estoque
        { title: 'Visão Geral do Estoque', description: 'Entenda o módulo de estoque', url: 'artigos/visao-geral-estoque.html', keywords: 'estoque visão geral módulo controle posição' },
        { title: 'Inventário de Estoque', description: 'Como fazer inventário', url: 'artigos/inventario-estoque.html', keywords: 'inventário contagem estoque balanço conferência' },
        { title: 'Ajuste de Estoque', description: 'Realizar ajustes manuais', url: 'artigos/ajuste-estoque.html', keywords: 'ajuste estoque correção quantidade entrada saída' },
        
        // Artigos - Notas Fiscais
        { title: 'Emitir NF-e', description: 'Passo a passo para emissão', url: 'artigos/emitir-nfe.html', keywords: 'emitir nfe nota fiscal eletrônica venda sefaz' },
        { title: 'Cancelar NF-e', description: 'Como cancelar notas emitidas', url: 'artigos/cancelar-nfe.html', keywords: 'cancelar nfe nota fiscal cancelamento sefaz prazo' },
        { title: 'Carta de Correção', description: 'Corrigir informações de NF-e', url: 'artigos/carta-correcao.html', keywords: 'carta correção cce nfe corrigir retificar' },
        { title: 'NFS-e Nacional', description: 'Nova nota fiscal de serviço eletrônica nacional', url: 'artigos/nfs-e-nacional.html', keywords: 'nfse nota serviço eletrônica nacional prefeitura' },
        
        // Artigos - Contabilidade
        { title: 'Plano de Contas', description: 'Configurar plano de contas contábil', url: 'artigos/plano-contas.html', keywords: 'plano contas contábil débito crédito lançamento classificação' },
        
        // Artigos - Relatórios
        { title: 'Visão Geral de Relatórios', description: 'Conheça os relatórios disponíveis', url: 'artigos/visao-geral-relatorios.html', keywords: 'relatório visão geral tipos disponíveis' },
        { title: 'Relatórios de Vendas', description: 'Análise de vendas e desempenho', url: 'artigos/relatorios-vendas.html', keywords: 'relatório venda análise desempenho faturamento' },
        { title: 'Relatórios Financeiros', description: 'Relatórios de fluxo e posição', url: 'artigos/relatorios-financeiros.html', keywords: 'relatório financeiro fluxo caixa dre resultado' },
        { title: 'Relatórios de Estoque', description: 'Posição e movimentação de estoque', url: 'artigos/relatorios-estoque.html', keywords: 'relatório estoque posição movimentação curva abc' },
        { title: 'Dashboard e Indicadores', description: 'Painéis gerenciais e KPIs', url: 'artigos/dashboard-indicadores.html', keywords: 'dashboard indicador kpi painel gráfico meta' },
        { title: 'Exportar Relatórios', description: 'Exportar para Excel e PDF', url: 'artigos/exportar-relatorios.html', keywords: 'exportar excel pdf csv download imprimir' },
        { title: 'Agendar Relatórios', description: 'Programar envio automático', url: 'artigos/agendar-relatorios.html', keywords: 'agendar programar email automático envio' },
        
        // Artigos - Segurança
        { title: 'Usuários e Permissões', description: 'Gerenciar acesso ao sistema', url: 'artigos/usuarios-permissoes.html', keywords: 'usuário permissão acesso perfil senha grupo' },
        
        // Artigos - App
        { title: 'Como Usar o App', description: 'Guia do aplicativo mobile', url: 'artigos/como-usar-app.html', keywords: 'app aplicativo celular mobile android ios instalar' },
        
        // Artigos - Portal
        { title: 'Integrações e API', description: 'Conectar com outros sistemas', url: 'artigos/integracoes-api.html', keywords: 'integração api webhook conectar sistema terceiro' },
        
        // Artigos - WhatsApp
        { title: 'Integração WhatsApp', description: 'Configurar WhatsApp Business', url: 'artigos/integracao-whatsapp.html', keywords: 'whatsapp integração mensagem notificação business' },
        
        // Artigos - Cenários
        { title: 'Cenários de Uso', description: 'Fluxos de trabalho completos', url: 'artigos/cenarios-uso.html', keywords: 'cenário uso fluxo trabalho exemplo prático' },
        
        // Artigos - Novidades
        { title: 'Novidades do Sistema', description: 'Últimas atualizações e melhorias', url: 'artigos/novidades-sistema.html', keywords: 'novidade atualização versão melhoria recurso novo' }
    ];

    // Detect base path
    const isInSubfolder = window.location.pathname.includes('/colecoes/') || window.location.pathname.includes('/artigos/');
    const basePath = isInSubfolder ? '../' : '';

    // Search functionality
    const headerSearch = document.getElementById('header-search');
    const mainSearch = document.getElementById('main-search');

    // Create search results container
    function createSearchResults() {
        const container = document.createElement('div');
        container.className = 'search-results-container';
        container.innerHTML = `
            <div class="search-results-overlay"></div>
            <div class="search-results-modal">
                <div class="search-results-header">
                    <h3>Resultados da Busca</h3>
                    <button class="search-close-btn"><i class="fas fa-times"></i></button>
                </div>
                <div class="search-results-list"></div>
            </div>
        `;
        document.body.appendChild(container);

        // Close events
        container.querySelector('.search-results-overlay').addEventListener('click', closeSearchResults);
        container.querySelector('.search-close-btn').addEventListener('click', closeSearchResults);

        return container;
    }

    function closeSearchResults() {
        const container = document.querySelector('.search-results-container');
        if (container) {
            container.classList.remove('active');
        }
    }

    function performSearch(query) {
        if (!query || query.length < 2) return;

        const searchTerms = query.toLowerCase().split(' ');
        const results = searchDatabase.filter(item => {
            const searchText = (item.title + ' ' + item.description + ' ' + item.keywords).toLowerCase();
            return searchTerms.every(term => searchText.includes(term));
        });

        showSearchResults(results, query);
    }

    function showSearchResults(results, query) {
        let container = document.querySelector('.search-results-container');
        if (!container) {
            container = createSearchResults();
        }

        const listEl = container.querySelector('.search-results-list');
        
        if (results.length === 0) {
            listEl.innerHTML = `
                <div class="search-no-results">
                    <i class="fas fa-search"></i>
                    <p>Nenhum resultado encontrado para "<strong>${query}</strong>"</p>
                    <span>Tente usar termos diferentes ou navegue pelas coleções</span>
                </div>
            `;
        } else {
            listEl.innerHTML = results.map(item => `
                <a href="${basePath}${item.url}" class="search-result-item">
                    <div class="search-result-icon">
                        <i class="fas fa-file-alt"></i>
                    </div>
                    <div class="search-result-content">
                        <h4>${item.title}</h4>
                        <p>${item.description}</p>
                    </div>
                    <i class="fas fa-chevron-right"></i>
                </a>
            `).join('');
        }

        container.classList.add('active');
    }

    // Handle search input
    function handleSearch(event) {
        if (event.key === 'Enter') {
            const query = event.target.value.trim();
            if (query) {
                performSearch(query);
            }
        }
    }

    if (headerSearch) {
        headerSearch.addEventListener('keypress', handleSearch);
    }

    if (mainSearch) {
        mainSearch.addEventListener('keypress', handleSearch);
    }

    // Add search styles
    const searchStyles = document.createElement('style');
    searchStyles.textContent = `
        .search-results-container {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 9999;
        }
        
        .search-results-container.active {
            display: block;
        }
        
        .search-results-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
        }
        
        .search-results-modal {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 16px;
            width: 90%;
            max-width: 600px;
            max-height: 80vh;
            overflow: hidden;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
        }
        
        .search-results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 24px;
            border-bottom: 1px solid #e5e7eb;
            background: #f8fafc;
        }
        
        .search-results-header h3 {
            margin: 0;
            font-size: 18px;
            color: #003366;
        }
        
        .search-close-btn {
            background: none;
            border: none;
            font-size: 20px;
            color: #64748b;
            cursor: pointer;
            padding: 8px;
            border-radius: 8px;
            transition: all 0.2s;
        }
        
        .search-close-btn:hover {
            background: #e2e8f0;
            color: #003366;
        }
        
        .search-results-list {
            max-height: 60vh;
            overflow-y: auto;
            padding: 16px;
        }
        
        .search-result-item {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px;
            border-radius: 12px;
            text-decoration: none;
            color: inherit;
            transition: all 0.2s;
            margin-bottom: 8px;
        }
        
        .search-result-item:hover {
            background: #f1f5f9;
        }
        
        .search-result-icon {
            width: 48px;
            height: 48px;
            background: linear-gradient(135deg, #003366, #0077CC);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            flex-shrink: 0;
        }
        
        .search-result-content {
            flex: 1;
        }
        
        .search-result-content h4 {
            margin: 0 0 4px 0;
            font-size: 16px;
            color: #1e293b;
        }
        
        .search-result-content p {
            margin: 0;
            font-size: 14px;
            color: #64748b;
        }
        
        .search-result-item > .fa-chevron-right {
            color: #94a3b8;
        }
        
        .search-no-results {
            text-align: center;
            padding: 48px 24px;
            color: #64748b;
        }
        
        .search-no-results i {
            font-size: 48px;
            color: #cbd5e1;
            margin-bottom: 16px;
        }
        
        .search-no-results p {
            font-size: 16px;
            margin: 0 0 8px 0;
            color: #475569;
        }
        
        .search-no-results span {
            font-size: 14px;
        }
    `;
    document.head.appendChild(searchStyles);

    // Add animation on scroll for collection cards
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    document.querySelectorAll('.collection-card, .novidade-card').forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(card);
    });

    // Helpful buttons functionality (for article pages)
    const helpfulButtons = document.querySelectorAll('.helpful-btn');
    helpfulButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            helpfulButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const isHelpful = this.dataset.helpful === 'yes';
            if (isHelpful) {
                showFeedbackMessage('Obrigado pelo seu feedback! 😊');
            } else {
                showFeedbackMessage('Sentimos muito. Vamos melhorar! 💪');
            }
        });
    });

    function showFeedbackMessage(message) {
        const existingMessage = document.querySelector('.feedback-message');
        if (existingMessage) {
            existingMessage.remove();
        }

        const messageEl = document.createElement('div');
        messageEl.className = 'feedback-message';
        messageEl.textContent = message;
        messageEl.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #003366;
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 10px 40px rgba(0, 51, 102, 0.3);
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(messageEl);

        setTimeout(() => {
            messageEl.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => messageEl.remove(), 300);
        }, 3000);
    }

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes slideOut {
            from {
                opacity: 1;
                transform: translateY(0);
            }
            to {
                opacity: 0;
                transform: translateY(20px);
            }
        }
        
        .section-header {
            margin-bottom: 1rem;
        }
        
        .section-title {
            font-size: 1.1rem;
            color: #003366;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .section-title i {
            color: #0077CC;
        }
    `;
    document.head.appendChild(style);

    // Header scroll effect
    let lastScroll = 0;
    const header = document.querySelector('.header');

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll <= 0) {
            header.style.boxShadow = 'none';
        } else {
            header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        }

        lastScroll = currentScroll;
    });

    // Close search on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSearchResults();
        }
    });
});
