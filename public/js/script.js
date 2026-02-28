// ========== LOGIN CENTRALIZADO E MENU DINMICO ==========
// Lista de emails do setor comercial
const comercialEmails = [
    'augusto.ladeira@aluforce.ind.br',
    'ariel.silva@aluforce.ind.br',
    'renata@aluforce.ind.br',
    'marcos.lima@aluforce.ind.br',
    'fabiano@aluforce.ind.br',
    'fabiola@aluforce.ind.br',
    'thaina@aluforce.ind.br',
    'marcia@aluforce.ind.br',
    'clemerson@aluforce.ind.br',
    'clemerson.silva@aluforce.ind.br',
    'clemerson.leandro@aluforce.ind.br',
    'guilherme@aluforce.ind.br',
    'andreia@aluforce.ind.br',
    'douglas@aluforce.ind.br',
    'simplesadmin@aluforce.ind.br'
];
async function handleLogin() {
    const loginForm = document.getElementById('login-form');
    if (!loginForm) return;
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (!response.ok) {
                alert('Usuário ou senha inválidos!');
                return;
            }
            const data = await response.json();
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            window.location.href = 'index.html';
        } catch (error) {
            alert('Erro ao fazer login.');
        }
    });
}

function renderSidebarMenu() {
    const user = JSON.parse(localStorage.getItem('userData') || '{}');
    const menu = document.querySelector('.menu, .sidebar-nav');
    if (!menu) return;
    let html = '';
    // Garante que apenas emails da lista admin são admin
    const adminEmails = [
        'simplesadmin@aluforce.ind.br',
        'andreia@aluforce.ind.br',
        'douglas@aluforce.ind.br'
    ];
    const isAdmin = adminEmails.includes((user.email || '').toLowerCase());
    if (isAdmin) {
        html = `
            <ul>
                <li><a href="CRM/crm.html"><i class="fas fa-filter"></i> CRM</a></li>
                <li><a href="Vendas/vendas.html"><i class="fas fa-chart-line"></i> Vendas</a></li>
                <li><a href="Financeiro/financeiro.html"><i class="fas fa-wallet"></i> Financeiro</a></li>
                <li><a href="PCP/pcp.html"><i class="fas fa-box"></i> PCP</a></li>
                <li><a href="RH/index.html"><i class="fas fa-user-tie"></i> RH</a></li>
                <li><a href="/NFe/nfe.html"><i class="fas fa-file-invoice"></i> NF-e</a></li>
            </ul>
        `;
    } else if (comercialEmails.includes((user.email || '').toLowerCase())) {
        html = `
            <ul>
                <li><a href="CRM/crm.html"><i class="fas fa-filter"></i> CRM</a></li>
                <li><a href="Vendas/vendas.html"><i class="fas fa-chart-line"></i> Vendas</a></li>
                <li><a href="RH/area.html"><i class="fas fa-user-tie"></i> RH</a></li>
            </ul>
        `;
    } else {
        html = `<ul><li><a href="#"><i class="fas fa-home"></i> Painel</a></li></ul>`;
    }
    menu.innerHTML = html;
}

// Função para esconder módulos não permitidos no dashboard
function hideUnauthorizedModules(role) {
    const cards = document.querySelectorAll('.module-card');
    if (role === 'admin') {
        cards.forEach(card => { card.style.display = ''; });
    } else if (role === 'comercial') {
        cards.forEach(card => {
            const href = card.getAttribute('href');
            if (href && (href.includes('CRM') || href.includes('Vendas') || href.includes('RH/area.html'))) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    } else {
        cards.forEach(card => {
            card.style.display = card.querySelector('span')?.textContent === 'Painel' ? '' : 'none';
        });
    }
}

// Função de logout
function logout() {
    localStorage.removeItem('jwt');
    localStorage.removeItem('userRole');
    window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    handleLogin();
    renderSidebarMenu();
    // Se estiver logado, esconde módulos não permitidos
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const adminEmails = [
        'simplesadmin@aluforce.ind.br',
        'andreia@aluforce.ind.br',
        'douglas@aluforce.ind.br'
    ];
    if (adminEmails.includes((userData.email || '').toLowerCase())) {
        hideUnauthorizedModules('admin');
    } else if (comercialEmails.includes(userData.email)) {
        hideUnauthorizedModules('comercial');
    } else if (userData.role) {
        hideUnauthorizedModules(userData.role);
    }
    // Saudação personalizada na sidebar (prefere apelido, senão nome completo)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && userData) {
        let nomeSaudacao = '';
        
        // Prioridade: 1. Apelido, 2. Nome completo (reduzido se necessário)
        if (userData.apelido && userData.apelido.trim() !== '') {
            nomeSaudacao = userData.apelido.trim();
        } else {
            nomeSaudacao = (userData.nome_completo && userData.nome_completo.trim()) ? userData.nome_completo.trim() : (userData.nome || '').trim();
            // Se ainda for longo, reduz para primeiro + último
            if (nomeSaudacao && typeof nomeSaudacao === 'string') {
                const partes = nomeSaudacao.split(/\s+/).filter(Boolean);
                if (partes.length > 2) {
                    nomeSaudacao = `${partes[0]} ${partes[partes.length - 1]}`;
                }
            }
        }
        
        const greetingBtn = document.createElement('div');
        greetingBtn.className = 'user-profile';
        greetingBtn.innerHTML = `<button class="user-link">Olá, ${nomeSaudacao || 'Usuário'}</button>`;
        sidebar.appendChild(greetingBtn);
    }
    // Adiciona evento de logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }
});
// ================= FINANCEIRO: FUNCIONALIDADES UNIFICADAS =====================
function initFinanceiroPage() {
    const menuItems = document.querySelectorAll('.menu li');
    menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            menuItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
        });
    });
}
// ================= PCP: FUNCIONALIDADES UNIFICADAS =====================
function initPCPPage() {
    // Referências aos elementos da UI
    const views = {
        dashboard: document.getElementById('dashboard-view'),
        novaOrdem: document.getElementById('nova-ordem-view'),
        materiais: document.getElementById('materiais-view'),
        ordemCompra: document.getElementById('ordem-compra-view')
    };
    const navLinks = {
        dashboard: document.getElementById('btn-dashboard'),
        novaOrdem: document.getElementById('btn-nova-ordem'),
        materiais: document.getElementById('btn-materiais'),
        ordemCompra: document.getElementById('btn-ordem-compra')
    };
    const forms = {
        novaOrdem: document.getElementById('form-nova-ordem'),
        novoMaterial: document.getElementById('form-novo-material'),
    ordemCompra: document.getElementById('form-ordem-compra')
    };
    const containers = {
        materiais: document.getElementById('tabela-materiais-container'),
        ordensCompra: document.getElementById('tabela-ordens-compra-container'),
    materialSelect: document.getElementById('material_compra_select')
    };
    // Integração unificada: usar rotas relativas e JWT
    const API_BASE_URL = '/api/pcp';
    // Função auxiliar para requisições autenticadas (igual RH/Vendas)
    async function fetchWithAuth(url, options) {
        options = options || {};
        // Send cookies for httpOnly JWT auth by default
        const fetchOptions = Object.assign({}, options, { credentials: 'include' });
        const token = localStorage.getItem('authToken');
        const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        // Keep supporting Authorization header if a token exists (backwards compatibility)
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (options.body instanceof FormData) delete headers['Content-Type'];
        try {
            const response = await fetch(url, Object.assign({}, fetchOptions, { headers }));
            if (response.status === 401 || response.status === 403) {
                // Clear only user-related storage and redirect to login
                localStorage.removeItem('userData');
                localStorage.removeItem('authToken');
                alert('Sessão inválida ou expirada. Por favor, faça login novamente.');
                window.location.href = '/login.html';
                return Promise.reject(new Error('Não autorizado'));
            }
            return response;
        } catch (error) {
            alert('Erro de conexão com o servidor.');
            return Promise.reject(error);
        }
    }
    let draggedCard = null;
    // --- LÓGICA DE NAVEGAÇÁO ---
    function showView(viewName) {
        Object.values(views).forEach(view => view.style.display = 'none');
        Object.values(navLinks).forEach(link => link.classList.remove('active'));
        views[viewName].style.display = 'block';
        navLinks[viewName].classList.add('active');
        // Carregar dados específicos da view
        if (viewName === 'dashboard') {
            carregarOrdens();
        } else if (viewName === 'materiais') {
            carregarMateriais();
        } else if (viewName === 'ordemCompra') {
            carregarOrdensDeCompra();
            carregarMateriaisParaSelect();
        }
    }

    Object.keys(navLinks).forEach(key => {
        navLinks[key].addEventListener('click', (e) => {
            e.preventDefault();
            showView(key);
        });
    });

    // --- LÓGICA DO PAINEL KANBAN ---
    async function carregarOrdens() {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/ordens`);
            if (!response.ok) throw new Error('Falha ao carregar ordens.');
            const ordens = await response.json();
            document.querySelectorAll('.cards-container').forEach(c => c.innerHTML = '');
            ordens.forEach(criarCardOrdem);
        } catch (error) {
            console.error(error);
        }
    }

    function criarCardOrdem(ordem) {
    const columnId = `coluna-${ordem.status.toLowerCase().replace(' ', '-')}`;
    const column = document.getElementById(columnId);
    if (!column) return;
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.draggable = true;
    card.dataset.id = ordem.id;
    card.innerHTML = `
        <div class="card-id">OP-${String(ordem.id).padStart(4, '0')}</div>
        <div class="card-desc">${ordem.descrição_produto}</div>
        <div class="card-footer">
            <span>Qtd: ${ordem.quantidade}</span>
            <span class="date">${new Date(ordem.data_previsao_entrega).toLocaleDateString()}</span>
        </div>
    `;
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    column.querySelector('.cards-container').appendChild(card);
    }
    
    // Funções de Drag & Drop
    function handleDragStart(e) {
        draggedCard = e.target;
        setTimeout(() => e.target.classList.add('dragging'), 0);
    }

    function handleDragEnd(e) {
        draggedCard.classList.remove('dragging');
        draggedCard = null;
    }

    document.querySelectorAll('.kanban-column').forEach(column => {
        column.addEventListener('dragover', e => {
            e.preventDefault();
            column.classList.add('drag-over');
        });
        column.addEventListener('dragleave', e => {
            column.classList.remove('drag-over');
        });
        column.addEventListener('drop', async e => {
            e.preventDefault();
            column.classList.remove('drag-over');
            if (draggedCard) {
                const cardId = draggedCard.dataset.id;
                const newStatus = column.dataset.status;
                try {
                    await fetchWithAuth(`${API_BASE_URL}/ordens/${cardId}/status`, {
                        method: 'PUT',
                        body: JSON.stringify({ status: newStatus })
                    });
                    column.querySelector('.cards-container').appendChild(draggedCard);
                } catch(error) {
                    console.error('Falha ao atualizar status:', error);
                }
            }
        });
    });

    // --- LÓGICA DOS FORMULÁRIOS ---

    // Nova Ordem de Produção
    forms.novaOrdem.addEventListener('submit', async (e) => {
        e.preventDefault();
        const novaOrdem = {
            código_produto: document.getElementById('código_produto').value,
            descrição_produto: document.getElementById('descrição_produto').value,
            quantidade: document.getElementById('quantidade').value,
            data_previsao_entrega: document.getElementById('data_previsao_entrega').value,
            observacoes: document.getElementById('observacoes').value
        };
        try {
            await fetchWithAuth(`${API_BASE_URL}/ordens`, {
                method: 'POST',
                body: JSON.stringify(novaOrdem)
            });
            forms.novaOrdem.reset();
            showView('dashboard');
        } catch (error) {
            console.error('Erro ao criar ordem:', error);
        }
    });

    // Novo Material
    forms.novoMaterial.addEventListener('submit', async (e) => {
        e.preventDefault();
        const novoMaterial = {
             código_material: document.getElementById('código_material_form').value,
             descrição: document.getElementById('descrição_material_form').value,
             unidade_medida: document.getElementById('unidade_medida_form').value,
             quantidade_estoque: parseFloat(document.getElementById('estoque_inicial_form').value) || 0
        };
        try {
            await fetchWithAuth(`${API_BASE_URL}/materiais`, {
                method: 'POST',
                body: JSON.stringify(novoMaterial)
            });
            forms.novoMaterial.reset();
            carregarMateriais();
        } catch(error) {
             console.error('Erro ao criar material:', error);
        }
    });

    // Nova Ordem de Compra
    forms.ordemCompra.addEventListener('submit', async (e) => {
        e.preventDefault();
        const novaOrdemCompra = {
             material_id: containers.materialSelect.value,
             quantidade: parseFloat(document.getElementById('quantidade_compra').value),
             previsao_entrega: document.getElementById('data_previsao_compra').value
        };
        if (!novaOrdemCompra.material_id) {
            alert('Por favor, selecione um material.');
            return;
        }
        try {
            await fetchWithAuth(`${API_BASE_URL}/ordens-compra`, {
                method: 'POST',
                body: JSON.stringify(novaOrdemCompra)
            });
            forms.ordemCompra.reset();
            carregarOrdensDeCompra();
        } catch (error) {
            console.error('Erro ao criar ordem de compra:', error);
        }
    });


    // --- LÓGICA DE CARREGAMENTO DE DADOS (NOVAS FUNÇÕES) ---
    
    // Carregar e renderizar tabela de materiais
    async function carregarMateriais() {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/materiais`);
            const materiais = await response.json();
            let tableHTML = `
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th>Código</th><th>Descrição</th><th>Estoque</th><th>Unidade</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${materiais.map(m => `
                            <tr>
                                <td>${m.código_material}</td>
                                <td>${m.descrição}</td>
                                <td>${m.quantidade_estoque.toFixed(2)}</td>
                                <td>${m.unidade_medida}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            containers.materiais.innerHTML = tableHTML;
        } catch (error) {
            console.error('Erro ao carregar materiais:', error);
            containers.materiais.innerHTML = '<p>Não foi possível carregar os materiais.</p>';
        }
    }

    // Carregar e renderizar histórico de ordens de compra
    async function carregarOrdensDeCompra() {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/ordens-compra`);
            const ordens = await response.json();
            let tableHTML = `
                 <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th>Cód. Material</th><th>Descrição</th><th>Qtd.</th><th>Data Pedido</th><th>Previsão Entrega</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ordens.map(o => `
                            <tr>
                                <td>${o.código_material}</td>
                                <td>${o.descrição}</td>
                                <td>${o.quantidade}</td>
                                <td>${new Date(o.data_pedido).toLocaleDateString()}</td>
                                <td>${new Date(o.previsao_entrega).toLocaleDateString()}</td>
                                <td>${o.status}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
             containers.ordensCompra.innerHTML = tableHTML;
        } catch (error) {
            console.error('Erro ao carregar ordens de compra:', error);
            containers.ordensCompra.innerHTML = '<p>Não foi possível carregar o histórico.</p>';
        }
    }
    
    // Popular o <select> de materiais no formulário de ordem de compra
    async function carregarMateriaisParaSelect() {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/materiais`);
            const materiais = await response.json();
            containers.materialSelect.innerHTML = '<option value="">-- Selecione um material --</option>';
            materiais.forEach(m => {
                const option = document.createElement('option');
                option.value = m.id;
                option.textContent = `${m.código_material} - ${m.descrição}`;
                containers.materialSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Erro ao carregar materiais para o select:', error);
        }
    }

    // --- INICIALIZAÇÁO ---
    showView('dashboard'); // Mostra o painel Kanban por defeito
} // fim initPCPPage

// Unificação: apenas UM event listener para DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    // Detecta se está na página Financeiro
    if (document.body.classList.contains('financeiro')) {
        initFinanceiroPage();
        return;
    }
    // Detecta se está na página PCP
    if (document.querySelector('.container-principal') && document.getElementById('dashboard-view')) {
        initPCPPage();
        return;
    }
    // Detecta se está na página Dashboard principal
    if (document.querySelector('main.dashboard-grid')) {
        initDashboardPage();
        return;
    }
    // Detecta se está na área admin RH
    if (document.getElementById('tabela-funcionarios') || document.body.classList.contains('admin-page')) {
        console.log("Inicializando a Área do Administrador...");
        initAdminPage();
        return;
    }
    // Detecta se está na área do funcionário RH
    if (document.getElementById('welcome-message')) {
        console.log("Inicializando o Portal do Funcionário...");
        initEmployeePage();
        return;
    }
    // Detecta se está na página NF-e (nfe.html)
    const nfeModal = document.getElementById('nfeModal');
    const openModalBtn = document.getElementById('openModalBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const nfeForm = document.getElementById('nfeForm');
    if (nfeModal && openModalBtn && closeModalBtn && cancelModalBtn && nfeForm) {
        // Função para abrir o modal
        const openModal = () => {
            nfeModal.style.display = 'flex';
        };
        // Função para fechar o modal
        const closeModal = () => {
            nfeModal.style.display = 'none';
        };
        // Event Listeners para abrir e fechar o modal
        openModalBtn.addEventListener('click', openModal);
        closeModalBtn.addEventListener('click', closeModal);
        cancelModalBtn.addEventListener('click', closeModal);
        // Fechar o modal ao clicar fora da área de conteúdo
        nfeModal.addEventListener('click', function(event) {
            if (event.target === nfeModal) {
                closeModal();
            }
        });
        // Event Listener para o envio do formulário
        nfeForm.addEventListener('submit', function(event) {
            event.preventDefault(); // Previne o recarregamento da página
            // Coleta os dados do formulário
            const formData = {
                cliente: document.getElementById('tomador').value,
                servico: document.getElementById('servico').value,
                cnae: document.getElementById('cnae').value,
                valor: document.getElementById('valor').value,
            };
            // Simula a emissão da NF-e
            console.log('--- Emitindo NF-e com os seguintes dados ---');
            console.log(formData);
            alert(`NF-e para o cliente ${formData.cliente} no valor de R$ ${formData.valor} enviada para emissão!`);
            // Limpa o formulário e fecha o modal
            nfeForm.reset();
            closeModal();
        });
        return;
    }
    // Se não detectou nenhum contexto conhecido
    console.warn("Nenhum contexto (Financeiro, PCP, Dashboard, RH, NF-e) detectado. O script não foi totalmente inicializado.");
});

// ================= UNIFICAÇÁO: SCRIPT PRINCIPAL + RH =====================
// Detecta automaticamente o contexto da página e inicializa o módulo correto
// Removido segundo event listener duplicado para DOMContentLoaded

// ===================================================================================
// == INÍCIO - LÓGICA DA ÁREA DO ADMINISTRADOR (RH SIMPLIFICADO) ==
// ===================================================================================
function initAdminPage() {
    // ...código do admin RH simplificado, se necessário...
    // (Se já existe uma versão mais completa, mantenha a mais robusta)
}

// ===================================================================================
// == INÍCIO - LÓGICA DO PORTAL DO FUNCIONÁRIO (RH SIMPLIFICADO) ==
// ===================================================================================
function initEmployeePage() {
    // ...código do funcionário RH simplificado, se necessário...
    // (Se já existe uma versão mais completa, mantenha a mais robusta)
}

/**
 * Função de simulação para desenvolvimento.
 * Cria dados de usuário no localStorage para que a página do funcionário funcione sem um login real.
 * Para usar, abra o console do navegador na página de login e digite: simulateLoginForEmployee()
 */
function simulateLoginForEmployee() {
    try {
        const userData = {
            nome: "Maria Oliveira",
            dataNascimento: "20/08/1992",
            cpf: "111.222.333-44",
            rg: "22.333.444-5",
            endereco: "Avenida Principal, 456 - São Paulo, SP",
            telefone: "(11) 91234-5678",
            email: "maria.oliveira@empresa.com",
            estadoCivil: "Solteira",
            dependentes: 0,
            dataAdmissao: "25/07/2021",
            banco: "Banco Itaú",
            agencia: "5678",
            conta: "12345-6"
        };
        localStorage.setItem('authToken', 'simulated-token-employee-789');
        localStorage.setItem('userData', JSON.stringify(userData));
        console.log('Login de funcionário simulado com sucesso!');
    } catch (error) {
        console.error('Erro ao simular login de funcionário:', error);
    }
}

// =================== DASHBOARD PRINCIPAL (antigo script.js) ===================
function initDashboardPage() {
    // --- ELEMENTOS DA DOM ---
    let currentUser = { name: 'Usuário', permissions: ['admin_all'], role: null, rawUser: null };
    // Detecta nome e formata saudação para Primeiro + Último
    let isRestrictedComercialUser = false;
    try {
        const userData = localStorage.getItem('userData');
        if (userData) {
            const user = JSON.parse(userData);
            currentUser.rawUser = user;
            const rawName = (user.nome_completo && user.nome_completo.trim()) ? user.nome_completo.trim() : (user.nome && user.nome.trim() ? user.nome.trim() : (user.email || 'Usuário'));
            const parts = rawName.split(/\s+/).filter(Boolean);
            let displayName = rawName;
            if (parts.length >= 2) {
                displayName = `${parts[0]} ${parts[parts.length - 1]}`;
            } else if (parts.length === 1) {
                displayName = parts[0];
            }
            currentUser = { name: displayName, permissions: user.permissions || ['admin_all'], role: user.role || null, rawUser: user };

            // ===== MAPEAMENTO: áreas do backend → módulos do dashboard =====
            // Se user.areas existe (vindo do /api/me ou login), usa para filtrar cards
            const backendAreas = user.areas || user.permissoes || null;
            if (backendAreas && Array.isArray(backendAreas) && backendAreas.length > 0 && !user.is_admin) {
                // Mapa: nome da área no backend → chave do módulo no dashboard
                const areaToModule = {
                    'financeiro': 'financas',
                    'rh': 'contador',
                    'vendas': 'vendas',
                    'compras': 'estoque',
                    'pcp': 'estoque',
                    'nfe': 'vendas',
                    'crm': 'crm',
                    'ti': 'admin_all',
                    'admin': 'admin_all',
                    'faturamento': 'vendas'
                };
                const mappedPermissions = [...new Set(backendAreas.map(a => areaToModule[a] || a).filter(Boolean))];
                if (mappedPermissions.length > 0 && !mappedPermissions.includes('admin_all')) {
                    currentUser.permissions = mappedPermissions;
                }
            }

            // Verifica se o primeiro nome está na lista de comerciais restritos
            const firstNameLower = (parts[0] || '').toLowerCase();
            const restrictedFirstNames = ['ariel','augusto','marcos','renata','marcia','thaina','fabiola','fabiano'];
            isRestrictedComercialUser = restrictedFirstNames.includes(firstNameLower);
        }
    } catch (e) {}

    const greetingH1 = document.querySelector('.greeting h1');
    const dashboardGrid = document.querySelector('main.dashboard-grid');
    const headerIcons = document.querySelector('.header-icons');

    // --- DARK MODE ---
        const darkModeBtn = document.querySelector('.header-icons .dark-mode-btn');
        const darkModeIcon = darkModeBtn ? darkModeBtn.querySelector('i') : null;

    function toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
        if (darkModeIcon) {
            if (isDark) {
                darkModeIcon.classList.remove('fa-sun');
                darkModeIcon.classList.add('fa-moon');
                darkModeBtn.title = 'Modo claro';
            } else {
                darkModeIcon.classList.remove('fa-moon');
                darkModeIcon.classList.add('fa-sun');
                darkModeBtn.title = 'Modo escuro';
            }
        }
        localStorage.setItem('darkMode', isDark ? '1' : '0');
    }

    if (localStorage.getItem('darkMode') === '1') {
        document.body.classList.add('dark-mode');
        if (darkModeIcon) {
            darkModeIcon.classList.remove('fa-sun');
            darkModeIcon.classList.add('fa-moon');
            darkModeBtn.title = 'Modo claro';
        }
    }

    if (darkModeBtn) {
        darkModeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDarkMode();
        });
    }

    // --- PERSONALIZAÇÁO E RENDERIZAÇÁO ---
    if (greetingH1) greetingH1.textContent = `Olá, ${currentUser.name}`;

    const allModules = {
        crm: { title: 'Módulo de CRM', icon: 'fa-filter', text: 'CRM' },
        vendas: { title: 'Módulo de Vendas e NF-e', icon: 'fa-chart-line', text: 'Vendas e NF-e' },
        servicos: { title: 'Módulo de Serviços e NFS-e', icon: 'fa-tasks', text: 'Serviços e NFS-e' },
        estoque: { title: 'Módulo de Compras, Estoque e Produção', icon: 'fa-box-open', text: 'Compras, Estoque e Produção' },
        financas: { title: 'Módulo de Finanças', icon: 'fa-dollar-sign', text: 'Finanças' },
        contador: { title: 'Recursos Humanos', icon: 'fa-user-tie', text: 'Recursos Humanos' }
    };
    
    const renderDashboard = () => {
        if (!dashboardGrid) return;
        dashboardGrid.innerHTML = '';
        let allowedModules = Object.keys(allModules);
        // Se for usuário de vendas, só mostra o módulo de vendas
        if (currentUser.role === 'vendas') {
            allowedModules = ['vendas'];
        }
        // Usuários comerciais específicos não devem ver Compras, Serviços e Finanças
        if (isRestrictedComercialUser) {
            allowedModules = allowedModules.filter(k => !['servicos','estoque','financas'].includes(k));
        }
        const userPermissions = currentUser.permissions;
        for (const moduleKey of allowedModules) {
            if (userPermissions.includes("admin_all") || userPermissions.includes(moduleKey) || currentUser.role === 'vendas') {
                const module = allModules[moduleKey];
                const card = document.createElement('a');
                if (moduleKey === 'vendas') {
                    card.href = 'Vendas/vendas.html';
                    card.target = '_self';
                } else if (moduleKey === 'contador') {
                    card.href = '#';
                    card.addEventListener('click', (e) => {
                        e.preventDefault();
                        try {
                            const raw = localStorage.getItem('userData');
                            const user = raw ? JSON.parse(raw) : {};
                            const email = (user.email || '').toLowerCase();
                            const adminEmails = ['simplesadmin@aluforce.ind.br','andreia@aluforce.ind.br','douglas@aluforce.ind.br'];
                            if (adminEmails.includes(email) || user.role === 'admin' || user.permissions?.includes('admin_all')) {
                                window.location.href = 'RH/areaadm.html';
                                return;
                            }
                            // Se for comercial (lista comercialEmails), envia para área do funcionário
                            if (comercialEmails.includes(email)) {
                                window.location.href = 'RH/area.html';
                                return;
                            }
                            // Default: se tiver role admin usa areaadm, senão area do funcionário
                            if (user.role === 'admin') window.location.href = 'RH/areaadm.html';
                            else window.location.href = 'RH/area.html';
                        } catch (err) {
                            // fallback
                            window.location.href = 'RH/area.html';
                        }
                    });
                } else {
                    card.href = '#';
                }
                card.className = `module-card ${moduleKey}`;
                card.setAttribute('data-module-title', module.title);
                card.innerHTML = `
                    <i class="fas ${module.icon}"></i>
                    <span>${module.text}</span>
                `;
                dashboardGrid.appendChild(card);
            }
        }
    };
    renderDashboard();

    // --- LÓGICA DA MODAL (EXISTENTE E MANTIDA) ---
    const modalOverlay = document.getElementById('modal-overlay');
    const modalContent = document.getElementById('modal-content');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const closeModalBtn = document.getElementById('modal-close-btn');

    const openModal = () => modalOverlay && modalOverlay.classList.remove('hidden');
    const closeModal = () => modalOverlay && modalOverlay.classList.add('hidden');
    
    if (dashboardGrid) {
        dashboardGrid.addEventListener('click', (event) => {
            const card = event.target.closest('.module-card');
            if (!card) return;
            // Não abrir modal para Vendas (redireciona) nem para Recursos Humanos (contador)
            if (card.classList.contains('vendas') || card.classList.contains('contador')) return;
            event.preventDefault();
            const title = card.getAttribute('data-module-title');
            const themeColorClass = Array.from(card.classList).find(cls => cls !== 'module-card');
            const themeColor = getComputedStyle(document.documentElement).getPropertyValue(`--color-${themeColorClass}`);
            if (modalTitle) modalTitle.textContent = title;
            if (modalContent) modalContent.style.borderColor = themeColor;
            if (modalBody) modalBody.innerHTML = `
                <p>As funcionalidades para o <strong>${title}</strong> serão implementadas aqui.</p>
                <p>Possíveis funcionalidades:</p>
                <ul>
                    <li>Listagem de Clientes/Produtos</li>
                    <li>Formulário de Cadastro</li>
                    <li>Relatórios e Gráficos</li>
                </ul>
            `;
            openModal();
        });
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalOverlay && !modalOverlay.classList.contains('hidden')) closeModal();
    });

    // --- MENU DE PERFIL E LOGOUT ---
    const userIcon = document.querySelector('.header-icons a[title="Perfil"]');
    if (userIcon) {
        const menu = document.createElement('div');
        menu.className = 'user-menu-dropdown';
        menu.style.display = 'none';
        menu.style.position = 'absolute';
        menu.style.top = '40px';
        menu.style.right = '0';
        menu.style.background = '#222c';
        menu.style.borderRadius = '8px';
        menu.style.boxShadow = '0 2px 8px #0003';
        menu.style.padding = '8px 0';
        menu.style.zIndex = '1000';
        menu.innerHTML = `<a href="#" id="logout-btn" style="display:block;padding:8px 24px;color:#fff;text-decoration:none;">Sair</a>`;
        userIcon.style.position = 'relative';
        userIcon.parentElement.style.position = 'relative';
        userIcon.parentElement.appendChild(menu);
        userIcon.addEventListener('click', (e) => {
            e.preventDefault();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!userIcon.contains(e.target) && !menu.contains(e.target)) {
                menu.style.display = 'none';
            }
        });
        menu.querySelector('#logout-btn').addEventListener('click', async (event) => {
            event.preventDefault();
            try {
                // Ask server to clear the auth cookie
                await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            } catch (e) {
                // ignore network errors here
            }
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            window.location.href = '/login.html';
        });
    }
}

// =================== RH: ADMIN ===================
// (copie aqui o conteúdo da função initAdminPage do app.js do RH)
// ...existing code from RH/app.js: function initAdminPage() {...}

// =================== RH: FUNCIONÁRIO ===================
// (copie aqui o conteúdo da função initEmployeePage do app.js do RH)
// ...existing code from RH/app.js: function initEmployeePage() {...}

// =================== FUNÇÕES GLOBAIS AUXILIARES ===================
// (copie aqui fetchWithAuth, showToast, formatDateToBR, etc. do app.js do RH)
// ...existing code from RH/app.js: fetchWithAuth, showToast, formatDateToBR