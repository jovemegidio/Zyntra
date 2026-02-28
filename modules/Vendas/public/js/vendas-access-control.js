/**
 * ALUFORCE - Controle de Acesso por Permissões de Vendas
 * 
 * Este script verifica as permissões do usuário logado e:
 * 1. Esconde itens da sidebar que o usuário não tem permissão
 * 2. Redireciona para o Kanban se tentar acessar página não permitida
 * 3. Controla permissões de supervisores para visualizar/editar pedidos
 * 4. Filtra relatórios por vendedor baseado nas permissões
 * 
 * Emails com acesso restrito (apenas Kanban):
 * - clemerson.silva@aluforce.ind.br
 * - guilherme.bastos@aluforce.ind.br
 * - thiago.scarcella@aluforce.ind.br
 * 
 * Supervisores (podem ver todos mas NÃO editar pedidos de outros):
 * - Renata (ID: 38)
 * - Augusto (ID: 5)
 */

(function() {
    'use strict';
    
    // ========================================
    // CONFIGURAÇÕES DE PERMISSÕES
    // ========================================
    
    // Emails com acesso restrito (apenas Kanban)
    const EMAILS_RESTRITOS = [
        'clemerson.silva@aluforce.ind.br',
        'guilherme.bastos@aluforce.ind.br',
        'thiago.scarcella@aluforce.ind.br'
    ];
    
    // Supervisores - podem ver relatórios de todos mas não editar pedidos de outros
    const SUPERVISORES = {
        IDS: [5, 38], // Augusto=5, Renata=38
        NOMES: ['augusto', 'renata'],
        EMAILS: ['augusto', 'renata']
    };
    
    // Vendedores da equipe comercial
    const VENDEDORES_IDS = {
        5: 'Augusto Ladeira dos Santos',
        12: 'Fabiano Marques',
        13: 'Fabíola Santos',
        22: 'Márcia Scarcella',
        38: 'Renata Maria Batista do Nascimento'
    };
    
    // Páginas que requerem permissões específicas
    const PAGINAS_RESTRITAS = {
        'pedidos.html': 'pedidos',
        'clientes.html': 'clientes',
        'dashboard.html': 'dashboard',
        'dashboard-admin.html': 'gestao',
        'relatorios.html': 'relatorios',
        'estoque.html': 'estoque',
        'comissoes.html': 'gestao'
    };
    
    // Página atual
    const paginaAtual = window.location.pathname.split('/').pop() || 'index.html';
    
    // ========================================
    // FUNÇÕES DE VERIFICAÇÃO DE PERMISSÕES
    // ========================================
    
    /**
     * Verifica se o usuário é supervisor (pode ver relatórios de todos)
     */
    function isSupervisor(user) {
        if (!user) return false;
        
        // Verificar por ID de funcionário
        if (user.funcionario_id && SUPERVISORES.IDS.includes(user.funcionario_id)) {
            return true;
        }
        
        // Verificar por nome
        const nomeUsuario = (user.nome || '').toLowerCase();
        if (SUPERVISORES.NOMES.some(nome => nomeUsuario.includes(nome))) {
            return true;
        }
        
        // Verificar por email
        const emailUsuario = (user.email || '').toLowerCase();
        if (SUPERVISORES.EMAILS.some(email => emailUsuario.includes(email))) {
            return true;
        }
        
        // Admin/TI/Diretoria sempre tem acesso total
        const roleUsuario = (user.role || '').toLowerCase();
        if (['admin', 'ti', 'diretoria', 'super_admin'].includes(roleUsuario)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Verifica se o usuário é admin (acesso total a tudo)
     */
    function isAdmin(user) {
        if (!user) return false;
        const roleUsuario = (user.role || '').toLowerCase();
        return ['admin', 'ti', 'diretoria', 'super_admin'].includes(roleUsuario) || user.is_admin === 1;
    }
    
    /**
     * Retorna o ID do vendedor associado ao usuário logado
     */
    function getVendedorIdFromUser(user) {
        if (!user) return null;
        
        // Tentar pelo funcionario_id direto
        if (user.funcionario_id && VENDEDORES_IDS[user.funcionario_id]) {
            return user.funcionario_id;
        }
        
        // Tentar pelo nome do usuário
        const nomeUsuario = (user.nome || '').toLowerCase();
        for (const [id, nome] of Object.entries(VENDEDORES_IDS)) {
            if (nome.toLowerCase().includes(nomeUsuario.split(' ')[0])) {
                return parseInt(id);
            }
        }
        
        // Tentar pelo email
        const emailUsuario = (user.email || '').toLowerCase();
        for (const [id, nome] of Object.entries(VENDEDORES_IDS)) {
            const primeiroNome = nome.split(' ')[0].toLowerCase();
            if (emailUsuario.includes(primeiroNome)) {
                return parseInt(id);
            }
        }
        
        return null;
    }
    
    /**
     * Verifica se o usuário pode EDITAR um pedido específico
     * Regra: Supervisores NÃO podem editar pedidos de outros vendedores
     */
    function podeEditarPedido(user, pedidoVendedorId) {
        if (!user) return false;
        
        // Admins podem editar qualquer pedido
        if (isAdmin(user)) return true;
        
        // Obter ID do vendedor do usuário logado
        const meuVendedorId = getVendedorIdFromUser(user);
        
        // Se for supervisor mas NÃO o dono do pedido, só pode visualizar
        if (isSupervisor(user) && meuVendedorId !== pedidoVendedorId) {
            return false;
        }
        
        // Vendedor comum só pode editar seus próprios pedidos
        if (meuVendedorId && meuVendedorId !== pedidoVendedorId) {
            return false;
        }
        
        return true;
    }
    
    // Verificar permissões ao carregar
    async function verificarPermissoesVendas() {
        try {
            // Verificar se há token antes de fazer requisição
            const token = localStorage.getItem('token');
            if (!token) {
                console.log('🔒 [VENDAS] Sem token - pulando verificação de permissões');
                return;
            }
            
            const headers = { 'Authorization': `Bearer ${token}` };
            const response = await fetch('/api/vendas/me', { 
                credentials: 'include',
                headers: headers
            });
            
            if (!response.ok) {
                console.log('🔒 [VENDAS] Não autenticado - permissões não verificadas');
                return; // Não está logado - não bloquear a página
            }
            
            const data = await response.json();
            const user = data.user || data;
            const email = (user.email || '').toLowerCase();
            
            // Verificar se é usuário restrito
            const isRestrito = EMAILS_RESTRITOS.includes(email);
            
            // Verificar permissões de vendas do banco
            let permVendas = user.permissoes_vendas;
            if (typeof permVendas === 'string') {
                try { permVendas = JSON.parse(permVendas); } catch(e) { permVendas = null; }
            }
            
            // Se é restrito ou tem permissões específicas de apenas kanban
            if (isRestrito || (permVendas && permVendas.kanban === true && !permVendas.pedidos)) {
                console.log('🔒 [VENDAS] Usuário com acesso restrito detectado:', email);
                
                // Aplicar restrições visuais na sidebar (esconder itens não permitidos)
                // NÃO redirecionar - apenas ocultar itens da sidebar
                aplicarRestricoesSidebar();
            }
            
            // Salvar dados do usuário e funções para outras funções usarem
            window.ALUFORCE_USER = user;
            window.ALUFORCE_PERMISSIONS = {
                isSupervisor: isSupervisor(user),
                isAdmin: isAdmin(user),
                vendedorId: getVendedorIdFromUser(user),
                podeEditarPedido: (pedidoVendedorId) => podeEditarPedido(user, pedidoVendedorId),
                SUPERVISORES,
                VENDEDORES_IDS
            };
            
            console.log('🔒 [VENDAS] Permissões:', {
                usuario: user.nome,
                isSupervisor: window.ALUFORCE_PERMISSIONS.isSupervisor,
                isAdmin: window.ALUFORCE_PERMISSIONS.isAdmin,
                vendedorId: window.ALUFORCE_PERMISSIONS.vendedorId
            });
            
        } catch (error) {
            console.error('Erro ao verificar permissões:', error);
        }
    }
    
    // Função para esconder itens da sidebar
    function aplicarRestricoesSidebar() {
        console.log('🔒 [VENDAS] Aplicando restrições de acesso - Apenas Kanban');
        
        // Esconder todos os botões da sidebar exceto Kanban
        const sidebarBtns = document.querySelectorAll('.sidebar-nav .sidebar-btn');
        sidebarBtns.forEach(btn => {
            // Verificar tanto title quanto data-title (tooltips-professional.js converte title → data-title)
            const title = btn.getAttribute('title') || btn.getAttribute('data-title');
            // Manter apenas o Kanban visível
            if (title && title !== 'Kanban') {
                btn.style.display = 'none';
            }
        });
        
        // Esconder tabs/abas extras se existirem
        const tabsBar = document.querySelector('.tabs-bar');
        if (tabsBar) tabsBar.style.display = 'none';
        
        // Esconder botão de configurações
        const configBtns = document.querySelectorAll('.sidebar-bottom .sidebar-btn');
        configBtns.forEach(btn => btn.style.display = 'none');
    }
    
    // Expor funções globalmente para uso em outras páginas
    window.VendasAccessControl = {
        isSupervisor,
        isAdmin,
        getVendedorIdFromUser,
        podeEditarPedido,
        SUPERVISORES,
        VENDEDORES_IDS
    };
    // Executar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', verificarPermissoesVendas);
    } else {
        verificarPermissoesVendas();
    }
})();
