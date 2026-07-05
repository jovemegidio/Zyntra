// Busca avançada e filtros para Gestão de Produtos
async function buscarProdutosGestao(page = 1, limit = 20) {
    // Coleta valores dos campos de busca/filtro
    const searchInput = document.getElementById('search-produtos-gestao');
    const categoriaSelect = document.getElementById('filter-categoria-gestao');
    const estoqueSelect = document.getElementById('filter-estoque-gestao');

    const query = searchInput ? searchInput.value.trim() : '';
    const categoria = categoriaSelect ? categoriaSelect.value : '';
    const estoque = estoqueSelect ? estoqueSelect.value : '';

    // Monta parâmetros para API/Paginação
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (categoria) params.append('categoria', categoria);
    if (estoque) params.append('estoque', estoque);
    params.append('page', page);
    params.append('limit', limit);

    let container = document.getElementById('tabela-produtos-gestao-container');
    if (!container) container = document.getElementById('tabela-produtos-container');
    if (!container) return;

    try {
        const res = await fetch(`/api/pcp/produtos?${params.toString()}`);
        const body = await res.json();
        const produtos = body.rows || [];
        const total = Number(body.total || 0);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        // Atualiza contadores na página Gestão de Produtos
        const totalProdutosEl = document.getElementById('stat-total-produtos-gestao');
        if (totalProdutosEl) totalProdutosEl.textContent = total;
        // Atualiza outros contadores se necessário (estoque baixo, crítico, normal)
        // Exemplo: contar produtos críticos
        let criticos = 0, ok = 0, baixo = 0;
        produtos.forEach(p => {
            if (p.status === 'CRITICO' || p.status === 'CRÍTICO') criticos++;
            else if (p.status === 'OK' || p.status === 'NORMAL') ok++;
            else if (p.status === 'BAIXO') baixo++;
        });
        const criticosEl = document.getElementById('stat-produtos-criticos-gestao');
        if (criticosEl) criticosEl.textContent = criticos;
        const okEl = document.getElementById('stat-produtos-ok-gestao');
        if (okEl) okEl.textContent = ok;
        const baixoEl = document.getElementById('stat-estoque-baixo-gestao');
        if (baixoEl) baixoEl.textContent = baixo;

        if (!Array.isArray(produtos) || produtos.length === 0) {
            container.innerHTML = '<div class="pad-12 muted">Nenhum produto encontrado.</div>';
            return;
        }

        const startIndex = ((page - 1) * limit) + 1;
        const endIndex = Math.min(total, page * limit);
        const infoLine = `<div class=\"info-line\">Mostrando ${startIndex}–${endIndex} de ${total} produtos</div>`;

        let tableHTML = `
            ${infoLine}
            <table class=\"estoque-table\">
                <thead>
                    <tr>
                        <th class=\"w-8pct\">Código</th>
                        <th>Descrição</th>
                        <th class=\"w-8pct\">SKU</th>
                        <th class=\"w-10pct\">GTIN</th>
                        <th class=\"w-8pct\">Unidade</th>
                        <th class=\"w-8pct text-center\">Estoque</th>
                        <th class=\"w-12pct\">Variações</th>
                        <th class=\"w-10pct\">Custo Unit.</th>
                        <th class=\"w-12pct text-center\">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${produtos.map(p => {
                        const codigo = p.codigo || p.codigo_produto || '';
                        const descricao = p.descricao || p.descricao_produto || '';
                        const sku = p.sku || '';
                        const gtin = p.gtin || '';
                        const unidade = p.unidade_medida || p.unidade || '';
                        const estoqueVal = Number(p.quantidade || p.estoque || p.quantidade_estoque || 0).toFixed(2);
                        const custo = p.custo_unitario || p.preco || 0;
                        let variacoes = [];
                        try {
                            const variacaoRaw = p.variacao || '';
                            if (Array.isArray(variacaoRaw)) {
                                variacoes = variacaoRaw.map(s => String(s).trim()).filter(Boolean);
                            } else if (typeof variacaoRaw === 'string' && variacaoRaw.trim().startsWith('[')) {
                                variacoes = JSON.parse(variacaoRaw.trim()).map(s => String(s).trim()).filter(Boolean);
                            } else if (typeof variacaoRaw === 'string' && variacaoRaw.trim()) {
                                variacoes = [variacaoRaw.trim()];
                            }
                        } catch (e) {
                            variacoes = [];
                        }
                        const variacoesDisplay = variacoes.length > 0 
                            ? variacoes.slice(0, 3).join(', ') + (variacoes.length > 3 ? '...' : '')
                            : 'N/A';
                        return `
                            <tr data-id=\"${p.id}\">
                                <td><strong>${codigo}</strong></td>
                                <td>${descricao}</td>
                                <td><span class=\"sku-badge\">${sku}</span></td>
                                <td><span class=\"gtin-text\">${gtin || '-'}</span></td>
                                <td>${unidade}</td>
                                <td class=\"text-center\">${estoqueVal}</td>
                                <td title=\"${variacoes.join(', ')}\">${variacoesDisplay}</td>
                                <td>R$ ${Number(custo).toFixed(2)}</td>
                                <td class=\"text-center\">
                                    <button class=\"btn-sm btn-editar-prod\" onclick=\"editarProduto(${p.id})\">
                                        <i class=\"fas fa-edit\"></i> Editar
                                    </button>
                                    <button class=\"btn-sm btn-excluir-prod\" onclick=\"excluirProduto(${p.id})\">
                                        <i class=\"fas fa-trash\"></i> Excluir
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        // Paginação tradicional
        if (totalPages > 1) {
            tableHTML += `
                <div class=\"pagination\">
                    ${page > 1 ? `<button class=\"btn-sm\" onclick=\"buscarProdutosGestao(${page - 1}, ${limit})\">« Anterior</button>` : ''}
                    <span>Página ${page} de ${totalPages}</span>
                    ${page < totalPages ? `<button class=\"btn-sm\" onclick=\"buscarProdutosGestao(${page + 1}, ${limit})\">Próxima »</button>` : ''}
                </div>
            `;
        }

        container.innerHTML = tableHTML;
    } catch (error) {
        if (container) {
            container.innerHTML = '<div class="pad-12 text-danger">Erro ao buscar produtos. Verifique a Conexão.</div>';
        }
    }
}

// Atalhos rápidos para filtros
function filtrarRapidoGestao(tipo) {
    const estoqueSelect = document.getElementById('filter-estoque-gestao');
    const searchInput = document.getElementById('search-produtos-gestao');
    if (!estoqueSelect || !searchInput) return;

    if (tipo === 'estoque-baixo') {
        estoqueSelect.value = 'baixo';
        searchInput.value = '';
    } else if (tipo === 'critico') {
        estoqueSelect.value = 'critico';
        searchInput.value = '';
    } else if (tipo === 'com-variacao') {
        estoqueSelect.value = '';
        searchInput.value = 'Variação';
    } else {
        estoqueSelect.value = '';
        searchInput.value = '';
    }
    buscarProdutosGestao(1, 20);
}

// Disponibiliza globalmente
window.buscarProdutosGestao = buscarProdutosGestao;
window.filtrarRapidoGestao = filtrarRapidoGestao;

// Atualiza contadores específicos da página Gestão de Produtos
async function updateCountersGestaoProdutos() {
    try {
        const response = await fetch(`${API_BASE_URL}/produtos?page=1&limit=10000`);
        if (!response.ok) throw new Error('Falha ao carregar produtos');
        
        const body = await response.json();
        const produtos = body.produtos || body.rows || (Array.isArray(body) ? body : []);
        const total = produtos.length;
        
        // Calcular estatísticas de estoque
        let estoqueBaixo = 0;
        let estoqueCritico = 0;
        let estoqueNormal = 0;
        
        produtos.forEach(p => {
            const estoque = Number(p.quantidade || p.estoque || p.quantidade_estoque || 0);
            const minimo = Number(p.estoque_minimo || 10);
            
            if (estoque <= 0) {
                estoqueCritico++;
            } else if (estoque <= minimo) {
                estoqueBaixo++;
            } else {
                estoqueNormal++;
            }
        });
        
        // Atualizar os elementos com animação
        const totalEl = document.getElementById('stat-total-produtos-gestao');
        const baixoEl = document.getElementById('stat-estoque-baixo-gestao');
        const criticoEl = document.getElementById('stat-produtos-criticos-gestao');
        const normalEl = document.getElementById('stat-produtos-ok-gestao');
        
        if (totalEl) animateCounter(totalEl, total, 1000);
        if (baixoEl) animateCounter(baixoEl, estoqueBaixo, 1000);
        if (criticoEl) animateCounter(criticoEl, estoqueCritico, 1000);
        if (normalEl) animateCounter(normalEl, estoqueNormal, 1000);
        
        console.log(`[updateCountersGestaoProdutos] Total: ${total}, Baixo: ${estoqueBaixo}, Crítico: ${estoqueCritico}, Normal: ${estoqueNormal}`);
        
    } catch (error) {
        console.error('Erro ao atualizar contadores de Gestão de Produtos:', error);
    }
}

// InicializAção da view de Gestão de Produtos
function initGestaoProdutos() {
    console.log('[initGestaoProdutos] Inicializando...');
    
    // Atualiza contadores específicos desta view
    updateCountersGestaoProdutos();

    // Inicializa busca inline (barra principal)
    initializeProductSearch();

    // Carrega produtos com Paginação Padrão
    carregarProdutos(1, 20);

    // Se houver filtros adicionais, inicialize aqui
    // Exemplo: document.getElementById('filtro-marca')?.addEventListener('change', ...)
}

// Garante que a Função está disponível globalmente (caso necessário)
window.initGestaoProdutos = initGestaoProdutos;
window.updateCountersGestaoProdutos = updateCountersGestaoProdutos;
// Modern PCP Interface Controller
console.log('JavaScript file loaded successfully');

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded event fired - PCP Interface starting initialization...');
    
    // Mobile sidebar toggle
    const menuToggle = document.querySelector('.menu-toggle-btn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (menuToggle && sidebar && overlay) {
        menuToggle.addEventListener('click', function() {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('visible');
        });
        
        overlay.addEventListener('click', function() {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        });
    }
    
    // User menu dropdown
    const userMenu = document.querySelector('.user-menu');
    const userDropdown = document.querySelector('.user-menu-dropdown');
    
    if (userMenu && userDropdown) {
        userMenu.addEventListener('click', function(e) {
            e.preventDefault();
            userDropdown.classList.toggle('show');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!userMenu.contains(e.target)) {
                userDropdown.classList.remove('show');
            }
        });
    }
    
    // Header refresh button functionality
    const refreshButton = document.getElementById('btn-refresh-header');
    if (refreshButton) {
        refreshButton.addEventListener('click', function() {
            const icon = this.querySelector('i');
            
            // Add rotation animation
            icon.style.transform = 'rotate(360deg)';
            icon.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            
            // Show loading state
            this.disabled = true;
            this.style.opacity = '0.7';
            
            // Simulate refresh process
            setTimeout(() => {
                // Reset animation
                icon.style.transform = 'rotate(0deg)';
                this.disabled = false;
                this.style.opacity = '1';
                
                // Show success feedback
                showToast('Dados atualizados com sucesso!', 'success');
                
                // Add a detailed notification about what was refreshed
                setTimeout(() => {
                    showToast('Inventário sincronizado - 245 itens atualizados', 'info');
                }, 500);
                
                // Refresh dashboard if active
                const currentView = document.querySelector('[id$="-view"]:not(.hidden)');
                if (currentView && currentView.id === 'dashboard-view') {
                    initializeDashboard();
                }
            }, 1500);
        });
    }
    
    // Header buttons functionality
    initializeHeaderButtons();
    
    // Simple test: Add click listener to logo for testing
    const logo = document.querySelector('.logo');
    if (logo) {
        logo.addEventListener('click', function() {
            console.log('Logo clicked - Event listeners are working!');
            showToast('Event listeners funcionando!', 'success');
        });
        console.log('Logo click test listener added');
    } else {
        console.log('Logo element not found');
    }
    
    // Navigation
    const navLinks = document.querySelectorAll('.sidebar-nav a');
    const views = {
        'btn-dashboard': 'dashboard-view',
        'btn-materiais': 'materiais-view',  
        'btn-ordem-compra': 'ordem-compra-view',
        'btn-ordens-producao': null, // Redirects to separate page
        'btn-faturamento': 'faturamento-view',
        'btn-gestao-produtos': 'gestao-produtos-view',
        'btn-sair': null // Special handling for logout
    };

    console.log('Found navigation links:', navLinks.length);
    console.log('Views mapping:', views);

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            console.log('Navigation link clicked:', this.id);
            
            // Handle logout button specially
            if (this.id === 'btn-sair') {
                e.preventDefault();
                handleLogout();
                return;
            }
            
            // Handle external page links (like ordens-producao.html)
            if (this.id === 'btn-ordens-producao') {
                // Let the default navigation happen (href="ordens-producao.html")
                return;
            }
            
            e.preventDefault();
            
            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));
            
            // Add active class to clicked link
            this.classList.add('active');
            
            // Hide all views
            const allViews = document.querySelectorAll('[id$="-view"]');
            console.log('Found views to hide:', allViews.length);
            allViews.forEach(view => {
                view.style.display = 'none';
                view.classList.remove('active');
                view.classList.add('hidden');
            });
            
            // Show corresponding view
            const viewId = views[this.id] || 'dashboard-view';
            console.log('Showing view:', viewId);
            const targetView = document.getElementById(viewId);
            if (targetView) {
                targetView.style.display = 'block';
                targetView.classList.add('active');
                targetView.classList.remove('hidden');
                console.log('View displayed successfully');
                
                // Initialize specific views with their data
                if (viewId === 'materiais-view') {
                    setTimeout(() => {
                        initializeMaterialsView();
                    }, 100);
                } else if (viewId === 'ordem-compra-view') {
                    setTimeout(() => {
                        if (typeof initOrdensCompra === 'function') {
                            initOrdensCompra();
                        }
                    }, 100);
                } else if (viewId === 'gestao-produtos-view') {
                    setTimeout(() => {
                        if (typeof initGestaoProdutos === 'function') {
                            initGestaoProdutos();
                        }
                    }, 100);
                }
                
                // Add notification based on the view being shown
                const viewNames = {
                    'dashboard-view': 'Dashboard',
                    'materiais-view': 'Gestão de Materiais',
                    'ordem-compra-view': 'Ordens de Compra',
                    'faturamento-view': 'Programação de Faturamento'
                };
                
                const viewName = viewNames[viewId];
                if (viewName) {
                    setTimeout(() => {
                        showToast(`Navegado para ${viewName}`, 'info');
                    }, 300);
                }
                
            } else {
                console.error('Target view not found:', viewId);
                showToast('Erro ao carregar a página solicitada', 'error');
            }
            
            // Close mobile sidebar if open
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('visible');
            }
        });
    });
    
    // Modal controls
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
            });
        }
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
    
    // Quick action buttons - usando onclick inline nos botões HTML
    // Os botões pcp-new-order, pcp-new-product e pcp-refresh usam onclick="window.abrirModalNovaOrdem()" etc.
    // não adicionar event listeners aqui para evitar conflitos
    
    // Function to open professional product modal (for new or edit)
    function openProductModal(productData = null) {
        // Use the professional modal instead of the old simple modal
        if (productData && productData.id) {
            // For edit mode, we could open the professional modal in edit mode
            // For now, just open the new product modal
            showToast(`Editando produto: ${productData.nome || 'ID ' + productData.id}`, 'info');
        }
        
        // Always open the professional new product modal
        if (window.abrirModalNovoProduto) {
            window.abrirModalNovoProduto();
        }
    }
    
    // Make openProductModal available globally for testing
    window.openProductModal = openProductModal;
    
    // Example function to simulate editing a product (for testing)
    window.editProduct = function(id) {
        const sampleProduct = {
            id: id || 123,
            nome: 'Produto Exemplo',
            categoria: 'Categoria A',
            preco: 99.99
        };
        openProductModal(sampleProduct);
    };
    
    // Close modal on ESC key or clicking outside
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modal:not(.hidden)');
            if (openModal) {
                openModal.classList.add('hidden');
                showToast('Modal fechado', 'info');
            }
        }
    });
    
    // Close modal when clicking on overlay
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal') && !e.target.classList.contains('hidden')) {
            e.target.classList.add('hidden');
            showToast('Modal fechado', 'info');
        }
    });
    
    // Refresh button no header (já tem onclick inline nos botões quick actions)
    const refreshBtn = document.getElementById('btn-refresh-header');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            location.reload();
        });
    }
    
    // Initialize dashboard with sample data
    initializeDashboard();
    
    // Initialize product search
    initializeProductSearch();
});

function performSearch(query) {
    // Use the new search function instead
    searchProductsAndDisplay(query);
}

// Updated search function that actually calls the API
async function searchProductsAndDisplay(query) {
    const searchResults = document.getElementById('search-inline-results');
    if (!searchResults || !query || query.trim().length < 2) {
        if (searchResults) {
            searchResults.classList.remove('visible');
            searchResults.setAttribute('aria-hidden', 'true');
        }
        return;
    }

    try {
        console.log('Searching for:', query);
        
        // Show loading state
        searchResults.innerHTML = `
            <div class="search-result-item">
                <div class="result-info">
                    <div class="result-title">
                        <i class="fas fa-spinner fa-spin"></i> Buscando produtos...
                    </div>
                </div>
            </div>
        `;
        searchResults.classList.add('visible');
        searchResults.setAttribute('aria-hidden', 'false');
        
        const products = await searchProducts(query);
        console.log('Search results:', products);
        
        if (!products || products.length === 0) {
            searchResults.innerHTML = `
                <div class="search-no-results">
                    <i class="fas fa-search"></i>
                    <p>Nenhum produto encontrado para "${query}"</p>
                    <small>Tente usar códigos ou descrições diferentes</small>
                </div>
            `;
        } else {
            displaySearchResults(products, searchResults);
        }
        
    } catch (error) {
        console.error('Search error:', error);
        searchResults.innerHTML = `
            <div class="search-error">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Erro na busca. Tente novamente.</p>
            </div>
        `;
        searchResults.classList.add('visible');
        searchResults.setAttribute('aria-hidden', 'false');
    }
}

function initializeDashboard() {
    // Initialize KPIs
    const kpiContainer = document.getElementById('pcp-kpis');
    if (kpiContainer) {
        kpiContainer.innerHTML = `
            <div class="pcp-kpi-card">
                <div class="kpi-label">Produtos</div>
                <div class="kpi-value">330</div>
            </div>
            <div class="pcp-kpi-card">
                <div class="kpi-label">Materiais</div>
                <div class="kpi-value">2</div>
            </div>
            <div class="pcp-kpi-card">
                <div class="kpi-label">Ordens a Fazer <i class="fas fa-square" style="color:#3b82f6;font-size:8px;margin-left:4px;"></i></div>
                <div class="kpi-value" style="color:#3b82f6;">0</div>
                <div class="kpi-progress" style="width:100%;height:4px;background:#e2e8f0;border-radius:2px;margin-top:8px;position:relative;">
                    <div style="width:30%;height:100%;background:#3b82f6;border-radius:2px;"></div>
                </div>
            </div>
        `;
    }
    
    // Initialize recent orders
    const recentOrdersContainer = document.getElementById('pcp-recent-orders');
    if (recentOrdersContainer) {
        recentOrdersContainer.innerHTML = `
            <div class="search-item">
                <div>
                    <strong>3B OFFICE MÓVEIS PARA ESCRITÓRIO LTDA</strong>
                    <div class="meta text-sm muted">TRN10_LAB, DUN10_ALU... • 18/09/2025 • orcamento</div>
                </div>
            </div>
            <div class="search-item">
                <div>
                    <strong>26.047.384 LUIZ ALBERTO FERREIRA LOPES</strong>
                    <div class="meta text-sm muted">TRN10_ALU, TRN10_LAB... • 18/09/2025 • orcamento</div>
                </div>
            </div>
            <div class="search-item">
                <div>
                    <strong>3B OFFICE MÓVEIS PARA ESCRITÓRIO LTDA</strong>
                    <div class="meta text-sm muted">TRN10_LAB, DUN10_ALU... • 18/09/2025 • orcamento</div>
                </div>
            </div>
            <div class="search-item" style="border-bottom:none;">
                <div>
                    <strong>26.047.384 LUIZ ALBERTO FERREIRA LOPES</strong>
                    <div class="meta text-sm muted">TRN10_ALU, TRN10_LAB... • 18/09/2025 • orcamento</div>
                </div>
            </div>
        `;
    }
    
    // Initialize low stock
    const lowStockContainer = document.getElementById('pcp-low-stock');
    if (lowStockContainer) {
        lowStockContainer.innerHTML = `
            <div class="text-center muted" style="padding: 40px 20px;">
                <div>Nenhum material com estoque baixo</div>
            </div>
        `;
    }

    // Trigger counters update so the KPI cards reflect live data on dashboard open
    try {
        updateCounters();
    } catch (e) {
        console.warn('Failed to update counters on dashboard initialization:', e);
    }
}

// Notification system for header bell
let notificationQueue = [];
let notificationId = 0;

// Load notifications from localStorage on startup
function loadNotificationsFromStorage() {
    try {
        const saved = localStorage.getItem('pcp_notifications');
        if (saved) {
            const data = JSON.parse(saved);
            notificationQueue = data.notifications || [];
            notificationId = data.lastId || 0;
            
            // Convert timestamp strings back to Date objects
            notificationQueue.forEach(notification => {
                if (typeof notification.timestamp === 'string') {
                    notification.timestamp = new Date(notification.timestamp);
                }
            });
        }
    } catch (error) {
        console.error('Error loading notifications from storage:', error);
        notificationQueue = [];
        notificationId = 0;
    }
}

// Save notifications to localStorage
function saveNotificationsToStorage() {
    try {
        const data = {
            notifications: notificationQueue.slice(0, 50), // Keep only last 50 notifications
            lastId: notificationId
        };
        localStorage.setItem('pcp_notifications', JSON.stringify(data));
    } catch (error) {
        console.error('Error saving notifications to storage:', error);
    }
}

    // Initialize notifications on page load
    loadNotificationsFromStorage();
    updateNotificationBadge();
    
    // Add some sample notifications if none exist (for demo purposes)
    if (notificationQueue.length === 0) {
        setTimeout(() => {
            showToast('Sistema iniciado com sucesso', 'success');
        }, 1000);
        
        setTimeout(() => {
            showToast('Verificação de estoque em andamento', 'info');
        }, 2000);
        
        setTimeout(() => {
            showToast('Novo pedido de compra recebido', 'warning');
        }, 3000);
    }// Enhanced showToast function that integrates with notification bell
function showToast(message, type = 'info', duration = 4000) {
    // Add to notification queue
    const notification = {
        id: ++notificationId,
        message: message,
        type: type,
        timestamp: new Date(),
        read: false,
        source: 'system' // Add source identifier
    };
    
    notificationQueue.unshift(notification);
    
    // Save to localStorage for persistence
    saveNotificationsToStorage();
    
    // Update badge count
    updateNotificationBadge();
    
    // Show toast as usual but shorter duration
    displayToast(message, type, duration);
    
    // Ring the bell
    ringNotificationBell();
    
    // Update notification panel if it's open
    updateNotificationPanel();
}

// Make showToast available globally for compatibility
window.showToast = showToast;

function displayToast(message, type, duration) {
    const container = document.getElementById('pcp-toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    var contentDiv = document.createElement('div');
    contentDiv.className = 'toast-content';
    var iconDiv = document.createElement('div');
    iconDiv.className = 'toast-icon';
    iconDiv.innerHTML = getToastIcon(type);
    contentDiv.appendChild(iconDiv);
    var msgDiv = document.createElement('div');
    msgDiv.className = 'toast-message';
    msgDiv.textContent = message;
    contentDiv.appendChild(msgDiv);
    toast.appendChild(contentDiv);
    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', function() { toast.remove(); });
    toast.appendChild(closeBtn);
    
    container.appendChild(toast);
    container.hidden = false;
    
    // Show toast with animation
    setTimeout(() => {
        toast.classList.remove('hidden');
    }, 100);
    
    // Auto remove
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
                if (container.children.length === 0) {
                    container.hidden = true;
                }
            }, 300);
        }
    }, duration);
}

function updateNotificationBadge() {
    const badge = document.getElementById('notification-count');
    const unreadCount = notificationQueue.filter(n => !n.read).length;
    
    if (badge) {
        badge.textContent = unreadCount;
        if (unreadCount > 0) {
            badge.classList.add('show');
            badge.classList.remove('hidden');
        } else {
            badge.classList.remove('show');
            badge.classList.add('hidden');
        }
    }
}

function ringNotificationBell() {
    const bell = document.querySelector('#notification-bell i');
    if (bell) {
        // Ring animation
        bell.style.animation = 'bellRing 0.6s ease-in-out';
        setTimeout(() => {
            bell.style.animation = '';
        }, 600);
    }
}

// Bell ring animation CSS will be added
function addBellRingAnimation() {
    if (!document.getElementById('bell-animation-style')) {
        const style = document.createElement('style');
        style.id = 'bell-animation-style';
        style.textContent = `
            @keyframes bellRing {
                0%, 100% { transform: rotate(0deg); }
                10%, 30%, 50%, 70%, 90% { transform: rotate(-10deg); }
                20%, 40%, 60%, 80% { transform: rotate(10deg); }
            }
        `;
        document.head.appendChild(style);
    }
}

function getToastIcon(type) {
    const icons = {
        success: '<i class="fas fa-check-circle"></i>',
        error: '<i class="fas fa-exclamation-circle"></i>',
        warning: '<i class="fas fa-exclamation-triangle"></i>',
        info: '<i class="fas fa-info-circle"></i>'
    };
    return icons[type] || icons.info;
}

// Logout functionality - Redireciona para o painel de controle
function handleLogout() {
    // Redirecionar diretamente para o painel de controle
    showToast('Retornando ao Painel de Controle...', 'info');
    
    // Adicionar animação ao ícone
    const sairBtn = document.getElementById('btn-sair');
    const icon = sairBtn?.querySelector('i');
    
    if (icon) {
        icon.style.transform = 'scale(1.2) rotate(-180deg)';
        icon.style.transition = 'transform 0.3s ease-out';
    }
    
    // Redirecionar após breve animação
    setTimeout(() => {
        window.location.href = window.__withBasePath ? window.__withBasePath('/dashboard') : '/dashboard';
    }, 300);
    
    return; // Código antigo abaixo (mantido comentado para referência)
    
    /* CÓDIGO ORIGINAL DE LOGOUT (DESABILITADO)
    // Show custom confirmation modal instead of native confirm
    const modal = document.getElementById('logout-confirmation-modal');
    const cancelBtn = document.getElementById('logout-cancel');
    const confirmBtn = document.getElementById('logout-confirm');
    
    // Show modal
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    
    // Focus on cancel button for accessibility
    cancelBtn.focus();
    
    // Handle cancel
    cancelBtn.onclick = function() {
        closeLogoutModal();
    };
    
    // Handle confirm
    confirmBtn.onclick = function() {
        // Disable button and show loading state immediately
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saindo...';
        confirmBtn.style.opacity = '0.8';
        
        // Close modal immediately
        closeLogoutModal();
        
        // Perform logout with minimal delay
        setTimeout(() => {
            performLogout();
        }, 100);
    };
    */
    
    // Close modal on ESC key
    const handleEscKey = function(e) {
        if (e.key === 'Escape') {
            closeLogoutModal();
            document.removeEventListener('keydown', handleEscKey);
        }
    };
    document.addEventListener('keydown', handleEscKey);
    
    // Close modal on backdrop click
    modal.onclick = function(e) {
        if (e.target === modal) {
            closeLogoutModal();
        }
    };
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-confirmation-modal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    
    // Reset button state for next use
    const confirmBtn = document.getElementById('logout-confirm');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sair';
        confirmBtn.style.opacity = '';
    }
    
    // Return focus to logout button
    const sairBtn = document.getElementById('btn-sair');
    if (sairBtn) {
        sairBtn.focus();
    }
}

function performLogout() {
    // Show loading state with toast
    showToast('Encerrando sessão...', 'info');
    
    // Add animation to logout icon
    const sairBtn = document.getElementById('btn-sair');
    const icon = sairBtn?.querySelector('i');
    
    if (icon) {
        icon.style.transform = 'scale(1.2) rotate(180deg)';
        icon.style.transition = 'transform 0.3s ease-out';
    }
    
    // Clear session data immediately
    localStorage.removeItem('userToken');
    sessionStorage.clear();
    
    // Try to call logout API (non-blocking)
    fetch('/api/pcp/logout', { method: 'POST' }).catch(() => {
        // Ignore errors - we're logging out anyway
    });
    
    // Show success message briefly and redirect immediately
    showLogoutSuccessToast();
    
    // Redirect immediately with minimal delay for UX feedback
    setTimeout(() => {
        window.location.href = 'login.html';
    }, 500);
}

function showLogoutSuccessToast() {
    const container = document.getElementById('pcp-toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = 'toast toast-success logout-toast';
    toast.innerHTML = `
        <div class="toast-content">
            <div class="toast-icon logout-toast-icon">
                <i class="fas fa-sign-out-alt"></i>
            </div>
            <div class="toast-message-wrapper">
                <div class="toast-title">Saindo...</div>
                <div class="toast-message">Redirecionando...</div>
            </div>
        </div>
        <div class="logout-toast-progress"></div>
    `;
    
    container.appendChild(toast);
    container.hidden = false;
    
    // Show toast with animation
    setTimeout(() => {
        toast.classList.remove('hidden');
    }, 100);
    
    // Animate progress bar
    const progressBar = toast.querySelector('.logout-toast-progress');
    setTimeout(() => {
        progressBar.style.width = '100%';
    }, 200);
    
    // Don't auto-remove this toast as it shows progress
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'pcp-toast-container';
    container.className = 'pcp-toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
    return container;
}

// User menu toggle function (for onclick in HTML)
function toggleUserMenu() {
    const dropdown = document.getElementById('user-menu-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

console.log('Modern PCP Interface Controller loaded');

// Initialize header buttons functionality
function initializeHeaderButtons() {
    console.log('Initializing header buttons...');
    console.log('Available elements in document:', document.querySelectorAll('*').length);
    
    // Dark mode toggle button
    const darkModeBtn = document.getElementById('btn-dark-mode-toggle');
    console.log('Dark mode button found:', !!darkModeBtn, darkModeBtn);
    if (darkModeBtn) {
        console.log('Adding click listener to dark mode button...');
        darkModeBtn.addEventListener('click', function() {
            console.log('Dark mode button clicked');
            const isDarkMode = document.body.classList.contains('dark-mode');
            toggleDarkModeFromButton(!isDarkMode);
        });
        console.log('Dark mode button listener added successfully');
    }
    
    // Grid/List view toggles
    const gridBtn = document.querySelector('.nav-icon-btn[title="Grid"]');
    const listBtn = document.querySelector('.nav-icon-btn[title="Lista"]');
    
    console.log('Grid button:', gridBtn);
    console.log('List button:', listBtn);
    
    if (gridBtn) {
        gridBtn.addEventListener('click', function() {
            console.log('Grid button clicked');
            toggleViewMode('grid');
            updateActiveViewButton(this, listBtn);
        });
    }
    
    if (listBtn) {
        listBtn.addEventListener('click', function() {
            console.log('List button clicked');
            toggleViewMode('list');
            updateActiveViewButton(this, gridBtn);
        });
    }
    
    // Notification buttons
    const notificationBtn = document.querySelector('#notification-bell');
    const messagesBtn = document.querySelector('.notification-btn[title="Mensagens"]');
    const settingsBtn = document.querySelector('.notification-btn[title="Configurações"]');
    
    console.log('Notification button:', notificationBtn);
    console.log('Messages button:', messagesBtn);
    console.log('Settings button:', settingsBtn);
    
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function() {
            console.log('Notification button clicked');
            handleNotifications();
        });
    }
    
    if (messagesBtn) {
        messagesBtn.addEventListener('click', handleMessages);
    }
    
    if (settingsBtn) {
        settingsBtn.addEventListener('click', handleSettings);
    }

    // Quick Actions: ensure the quick '+ Novo Produto' button opens the professional modal
    try {
        const quickNewProduct = document.getElementById('pcp-new-product');
        if (quickNewProduct) {
            // If it already has an onclick from HTML, we don't override it, otherwise attach handler
            if (!quickNewProduct.onclick) {
                quickNewProduct.addEventListener('click', function (e) {
                    e.preventDefault();
                    try { abrirModalNovoProduto(); } catch (err) { console.error('Erro ao abrir modal novo produto:', err); }
                });
            }
        }
    } catch (e) {
        console.warn('Could not wire Quick Actions new product button:', e && e.message ? e.message : e);
    }
    
    // User menu items
    const userMenuLinks = document.querySelectorAll('#user-menu-dropdown a');
    
    userMenuLinks.forEach(link => {
        if (link.querySelector('.fa-user')) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                handleUserProfile();
                toggleUserMenu(); // Close dropdown
            });
        } else if (link.querySelector('.fa-cog')) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                handleUserSettings();
                toggleUserMenu(); // Close dropdown
            });
        } else if (link.id === 'btn-logout') {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                handleLogout();
                toggleUserMenu(); // Close dropdown
            });
        }
    });
}

// View mode toggle functionality
function toggleViewMode(mode) {
    const currentView = document.querySelector('[id$="-view"]:not(.hidden)');
    if (!currentView) return;
    
    const dashboardGrid = currentView.querySelector('.dashboard-grid');
    const panelBodies = currentView.querySelectorAll('.panel-body');
    
    if (mode === 'grid') {
        if (dashboardGrid) {
            dashboardGrid.classList.remove('list-mode');
            dashboardGrid.classList.add('grid-mode');
        }
        panelBodies.forEach(panel => {
            panel.classList.remove('list-view');
            panel.classList.add('grid-view');
        });
        showToast('Visualização em grade ativada', 'info');
    } else if (mode === 'list') {
        if (dashboardGrid) {
            dashboardGrid.classList.remove('grid-mode');
            dashboardGrid.classList.add('list-mode');
        }
        panelBodies.forEach(panel => {
            panel.classList.remove('grid-view');
            panel.classList.add('list-view');
        });
        showToast('Visualização em lista ativada', 'info');
    }
}

function updateActiveViewButton(activeBtn, inactiveBtn) {
    // Add active state to clicked button
    activeBtn.classList.add('active');
    activeBtn.style.background = 'var(--cor-primaria)';
    activeBtn.style.color = '#ffffff';
    
    // Remove active state from other button
    if (inactiveBtn) {
        inactiveBtn.classList.remove('active');
        inactiveBtn.style.background = 'transparent';
        inactiveBtn.style.color = 'var(--cor-texto-claro)';
    }
}

// Notifications functionality
function handleNotifications() {
    const icon = document.querySelector('.notification-btn[title="Notificações"] i');
    
    // Animate bell
    ringNotificationBell();
    
    // Show notifications modal/panel
    showNotificationsPanel();
    
    // Mark all notifications as read
    notificationQueue.forEach(n => n.read = true);
    saveNotificationsToStorage();
    updateNotificationBadge();
}

// Function to update notification panel if it's currently open
function updateNotificationPanel() {
    const modalContent = document.querySelector('.quick-modal .modal-content');
    if (modalContent && modalContent.innerHTML.includes('Notificações Recentes')) {
        // Panel is open, refresh it
        setTimeout(() => {
            showNotificationsPanel();
        }, 100);
    }
}

function showNotificationsPanel() {
    let notificationsHtml = '<div class="notifications-header"><h4>Notificações Recentes</h4>';
    
    if (notificationQueue.length > 0) {
        notificationsHtml += `<button class="clear-notifications-btn" onclick="clearAllNotifications()">Limpar Todas</button>`;
    }
    
    notificationsHtml += '</div><div class="notifications-list">';
    
    if (notificationQueue.length === 0) {
        notificationsHtml += '<div class="no-notifications">Nenhuma Notificação recente</div>';
    } else {
        notificationQueue.slice(0, 20).forEach(notif => {
            const timeAgo = getTimeAgo(notif.timestamp);
            const typeClass = notif.type || 'info';
            notificationsHtml += `
                <div class="notification-item ${typeClass} ${!notif.read ? 'unread' : ''}" data-id="${notif.id}">
                    <div class="notification-icon">
                        ${getToastIcon(notif.type)}
                    </div>
                    <div class="notification-content">
                        <div class="notification-message">${notif.message}</div>
                        <div class="notification-time">${timeAgo}</div>
                        ${notif.source ? `<div class="notification-source">Sistema</div>` : ''}
                    </div>
                    <button class="notification-remove" onclick="removeNotification(${notif.id})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        });
    }
    
    notificationsHtml += '</div>';
    
    showQuickModal('Notificações', notificationsHtml);
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}d atrás`;
    if (hours > 0) return `${hours}h atrás`;
    if (minutes > 0) return `${minutes}min atrás`;
    return 'Agora mesmo';
}

function removeNotification(id) {
    notificationQueue = notificationQueue.filter(n => n.id !== id);
    updateNotificationBadge();
    
    // Remove from DOM
    const notifElement = document.querySelector(`[data-id="${id}"]`);
    if (notifElement) {
        notifElement.style.transform = 'translateX(100%)';
        notifElement.style.opacity = '0';
        setTimeout(() => {
            notifElement.remove();
            
            // Check if no more notifications
            const remainingNotifs = document.querySelectorAll('.notification-item');
            if (remainingNotifs.length === 0) {
                const notifsList = document.querySelector('.notifications-list');
                if (notifsList) {
                    notifsList.innerHTML = '<div class="no-notifications">Nenhuma Notificação recente</div>';
                }
            }
        }, 300);
    }
}

function clearAllNotifications() {
    showConfirmModal({
        type: 'danger',
        title: 'Limpar Notificações',
        message: 'Tem certeza que deseja limpar todas as notificações? Esta Ação não pode ser desfeita.',
        confirmText: 'Limpar Todas',
        cancelText: 'Cancelar'
    }).then(confirmed => {
        if (confirmed) {
            notificationQueue = [];
            saveNotificationsToStorage();
            updateNotificationBadge();
            
            const notifsList = document.querySelector('.notifications-list');
            if (notifsList) {
                notifsList.innerHTML = '<div class="no-notifications">Nenhuma Notificação recente</div>';
            }
            
            // Remove clear button
            const clearBtn = document.querySelector('.clear-notifications-btn');
            if (clearBtn) {
                clearBtn.remove();
            }
            
            showToast('Todas as notificações foram limpas', 'success');
        }
    });
}

function removeNotification(notificationId) {
    notificationQueue = notificationQueue.filter(n => n.id !== notificationId);
    saveNotificationsToStorage();
    updateNotificationBadge();
    
    // Remove from DOM
    const notifElement = document.querySelector(`[data-id="${notificationId}"]`);
    if (notifElement) {
        notifElement.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            notifElement.remove();
            
            // Check if there are no more notifications
            const remainingNotifs = document.querySelectorAll('.notification-item');
            if (remainingNotifs.length === 0) {
                const notifsList = document.querySelector('.notifications-list');
                if (notifsList) {
                    notifsList.innerHTML = '<div class="no-notifications">Nenhuma Notificação recente</div>';
                }
                
                // Remove clear button
                const clearBtn = document.querySelector('.clear-notifications-btn');
                if (clearBtn) {
                    clearBtn.remove();
                }
            }
        }, 300);
    }
}

// Messages functionality
function handleMessages() {
    const icon = document.querySelector('.notification-btn[title="Mensagens"] i');
    
    // Pulse animation
    icon.style.transform = 'scale(1.2)';
    setTimeout(() => {
        icon.style.transform = 'scale(1)';
    }, 200);
    
    showMessagesPanel();
}

function showMessagesPanel() {
    const messages = [
        { from: 'João Silva', message: 'Preciso verificar o status da ordem #1234', time: '10 min atrás', unread: true },
        { from: 'Maria Santos', message: 'Material chegou no estoque', time: '30 min atrás', unread: true },
        { from: 'Sistema', message: 'Backup realizado com sucesso', time: '1 hora atrás', unread: false },
        { from: 'Carlos Oliveira', message: 'Reunião às 14h sobre Produção', time: '2 horas atrás', unread: false }
    ];
    
    let messagesHtml = '<div class="messages-header"><h4>Mensagens</h4></div><div class="messages-list">';
    
    messages.forEach(msg => {
        messagesHtml += `
            <div class="message-item ${msg.unread ? 'unread' : ''}">
                <div class="message-avatar">
                    <i class="fas fa-user-circle"></i>
                </div>
                <div class="message-content">
                    <div class="message-from">${msg.from}</div>
                    <div class="message-text">${msg.message}</div>
                    <div class="message-time">${msg.time}</div>
                </div>
                ${msg.unread ? '<div class="message-indicator"></div>' : ''}
            </div>
        `;
    });
    
    messagesHtml += '</div>';
    
    showQuickModal('Mensagens', messagesHtml);
}

// Settings functionality  
function handleSettings() {
    const icon = document.querySelector('.notification-btn[title="Configurações"] i');
    
    // Rotate animation
    icon.style.transform = 'rotate(180deg)';
    setTimeout(() => {
        icon.style.transform = 'rotate(0deg)';
    }, 300);
    
    showSettingsPanel();
}

function showSettingsPanel() {
    const settingsHtml = `
        <div class="settings-header"><h4>Configurações Rápidas</h4></div>
        <div class="settings-list">
            <div class="setting-item">
                <div class="setting-label">
                    <i class="fas fa-moon"></i>
                    Modo Escuro
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="dark-mode-toggle">
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="setting-item">
                <div class="setting-label">
                    <i class="fas fa-bell"></i>
                    Notificações Push
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="push-notifications" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="setting-item">
                <div class="setting-label">
                    <i class="fas fa-sync-alt"></i>
                    Auto Refresh (5min)
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="auto-refresh" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>
    `;
    
    showQuickModal('Configurações', settingsHtml);
    
    // Add toggle functionality after modal is shown
    setTimeout(() => {
        document.getElementById('dark-mode-toggle')?.addEventListener('change', toggleDarkMode);
        document.getElementById('push-notifications')?.addEventListener('change', togglePushNotifications);
        document.getElementById('auto-refresh')?.addEventListener('change', toggleAutoRefresh);
    }, 100);
}

// User profile functionality
function handleUserProfile() {
    const profileHtml = `
        <div class="profile-header">
            <div class="profile-avatar">
                <img src="avatars/Clemerson.webp" alt="Clemerson" />
            </div>
            <div class="profile-info">
                <h4>Clemerson Santos</h4>
                <p>Supervisor de Produção</p>
                <p class="profile-email">clemerson@aluforce.com</p>
            </div>
        </div>
        <div class="profile-stats">
            <div class="stat-item">
                <div class="stat-label">Ordens Criadas</div>
                <div class="stat-value">127</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Produtos Cadastrados</div>
                <div class="stat-value">89</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Último Login</div>
                <div class="stat-value">Hoje, 08:30</div>
            </div>
        </div>
    `;
    
    showQuickModal('Meu Perfil', profileHtml);
}

// User settings functionality
function handleUserSettings() {
    const userSettingsHtml = `
        <div class="user-settings-header"><h4>Preferências do Usuário</h4></div>
        <div class="user-settings-list">
            <div class="setting-group">
                <h5>Interface</h5>
                <div class="setting-item">
                    <label for="language-select">Idioma</label>
                    <select id="language-select" class="modern-input">
                        <option value="pt-BR" selected>Português (Brasil)</option>
                        <option value="en-US">English (US)</option>
                        <option value="es-ES">Español</option>
                    </select>
                </div>
                <div class="setting-item">
                    <label for="theme-select">Tema</label>
                    <select id="theme-select" class="modern-input">
                        <option value="light" selected>Claro</option>
                        <option value="dark">Escuro</option>
                        <option value="auto">Automático</option>
                    </select>
                </div>
            </div>
            <div class="setting-group">
                <h5>Notificações</h5>
                <div class="setting-item">
                    <label>
                        <input type="checkbox" checked> Notificações de Email
                    </label>
                </div>
                <div class="setting-item">
                    <label>
                        <input type="checkbox" checked> Alertas de Estoque Baixo
                    </label>
                </div>
            </div>
        </div>
    `;
    
    showQuickModal('Configurações do Usuário', userSettingsHtml);
}

// Quick modal utility
function showQuickModal(title, content) {
    // Remove existing quick modal if any
    const existingModal = document.getElementById('quick-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'quick-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-dialog modal-sm">
            <div class="modal-header">
                <h3>${title}</h3>
                <button type="button" class="modal-close" onclick="document.getElementById('quick-modal').remove()">×</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Show modal
    setTimeout(() => {
        modal.classList.remove('hidden');
    }, 10);
    
    // Close on backdrop click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Close on ESC key
    const handleEsc = function(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// Toggle functions for settings
function toggleDarkModeFromButton(enable) {
    const body = document.body;
    const icon = document.getElementById('dark-mode-icon');
    
    // Function to update all logo images with smooth transition
    function updateLogos(isDarkMode) {
        const logos = document.querySelectorAll('.header-logo');
        const logoSrc = isDarkMode 
            ? 'Logo Monocromatico - Branco - Aluforce copy.webp'
            : 'Logo Monocromatico - Azul - Aluforce.webp';
        
        logos.forEach(logo => {
            // Create smooth transition effect
            logo.style.opacity = '0.5';
            setTimeout(() => {
                logo.src = logoSrc;
                logo.style.opacity = '1';
            }, 150);
        });
    }
    
    if (enable) {
        body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'enabled');
        showToast('Modo escuro ativado', 'success');
        updateDarkModeVariables(true);
        
        // Update logo to white version
        updateLogos(true);
        
        // Update icon
        if (icon) {
            icon.className = 'fas fa-sun';
            icon.parentElement.title = 'Alternar para Modo Claro';
        }
        
        // Update settings toggle if open
        const settingsToggle = document.getElementById('dark-mode-toggle');
        if (settingsToggle) {
            settingsToggle.checked = true;
        }
    } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'disabled');
        showToast('Modo claro ativado', 'success');
        updateDarkModeVariables(false);
        
        // Update logo to blue version
        updateLogos(false);
        
        // Update icon
        if (icon) {
            icon.className = 'fas fa-moon';
            icon.parentElement.title = 'Alternar Modo Escuro';
        }
        
        // Update settings toggle if open
        const settingsToggle = document.getElementById('dark-mode-toggle');
        if (settingsToggle) {
            settingsToggle.checked = false;
        }
    }
}

function toggleDarkMode(e) {
    const isEnabled = e.target.checked;
    toggleDarkModeFromButton(isEnabled);
}

function updateDarkModeVariables(isDark) {
    const root = document.documentElement;
    
    if (isDark) {
        root.style.setProperty('--cor-fundo', '#0f172a');
        root.style.setProperty('--cor-container', '#1e293b');
        root.style.setProperty('--cor-texto', '#f8fafc');
        root.style.setProperty('--cor-texto-claro', '#94a3b8');
        root.style.setProperty('--cor-borda', '#334155');
    } else {
        root.style.setProperty('--cor-fundo', '#f8fafc');
        root.style.setProperty('--cor-container', '#ffffff');
        root.style.setProperty('--cor-texto', '#1e293b');
        root.style.setProperty('--cor-texto-claro', '#64748b');
        root.style.setProperty('--cor-borda', '#e2e8f0');
    }
}

// Check for saved dark mode preference on load
function initializeDarkMode() {
    const darkMode = localStorage.getItem('darkMode');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const darkModeIcon = document.getElementById('dark-mode-icon');
    const darkModeBtn = document.getElementById('btn-dark-mode-toggle');
    
    // Function to update all logo images
    function updateLogos(isDarkMode) {
        const logos = document.querySelectorAll('.header-logo');
        const logoSrc = isDarkMode 
            ? 'Logo Monocromatico - Branco - Aluforce copy.webp'
            : 'Logo Monocromatico - Azul - Aluforce.webp';
        
        logos.forEach(logo => {
            logo.src = logoSrc;
        });
    }
    
    if (darkMode === 'enabled') {
        document.body.classList.add('dark-mode');
        updateDarkModeVariables(true);
        
        // Update logo to white version
        updateLogos(true);
        
        // Update settings toggle
        if (darkModeToggle) {
            darkModeToggle.checked = true;
        }
        
        // Update header button icon
        if (darkModeIcon) {
            darkModeIcon.className = 'fas fa-sun';
        }
        if (darkModeBtn) {
            darkModeBtn.title = 'Alternar para Modo Claro';
        }
    } else {
        // Ensure light mode is properly set
        document.body.classList.remove('dark-mode');
        updateDarkModeVariables(false);
        
        // Update logo to blue version
        updateLogos(false);
        
        if (darkModeIcon) {
            darkModeIcon.className = 'fas fa-moon';
        }
        if (darkModeBtn) {
            darkModeBtn.title = 'Alternar Modo Escuro';
        }
    }
}

// Initialize dark mode on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeDarkMode();
    addBellRingAnimation();
    
    // Add some demo notifications after a delay
    setTimeout(() => {
        showToast('Sistema iniciado com sucesso', 'success');
    }, 2000);
    
    setTimeout(() => {
        showToast('Verificação de estoque em andamento', 'info');
    }, 4000);
});

function togglePushNotifications(e) {
    if (e.target.checked) {
        showToast('Notificações push ativadas', 'success');
    } else {
        showToast('Notificações push desativadas', 'warning');
    }
}

function toggleAutoRefresh(e) {
    if (e.target.checked) {
        showToast('Auto refresh ativado (5min)', 'success');
        // TODO: Implement auto refresh logic
    } else {
        showToast('Auto refresh desativado', 'warning');
    }
}

// API Configuration - Usar URL relativa para funcionar em qualquer porta
const API_BASE_URL = '/api/pcp';

// Functions to load materials and products data
async function carregarMateriais() {
    console.log('Loading materiais from:', `${API_BASE_URL}/materiais`);
    try {
        const response = await fetch(`${API_BASE_URL}/materiais`);
        console.log('Response status:', response.status, response.ok);
        
        if (!response.ok) throw new Error('Falha ao carregar materiais');
        
        const materiais = await response.json();
        console.log('Materiais loaded:', materiais.length, materiais);
        
        const container = document.getElementById('tabela-materiais-container');
        console.log('Container found:', !!container);
        
        if (!container) return;
        
        if (!Array.isArray(materiais) || materiais.length === 0) {
            container.innerHTML = '<div class="pad-12 muted">Nenhum material cadastrado.</div>';
            return;
        }
        
        let tableHTML = `
            <table class="estoque-table">
                <thead>
                    <tr>
                        <th class="w-12pct">Código</th>
                        <th>Descrição</th>
                        <th class="w-12pct text-center">Estoque</th>
                        <th class="w-12pct">Unidade</th>
                        <th class="w-14pct text-center">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${materiais.map(m => `
                        <tr data-id="${m.id}">
                            <td><strong>${m.codigo_material || ''}</strong></td>
                            <td>${m.descricao || ''}</td>
                            <td class="text-center">${Number(m.quantidade_estoque || 0).toFixed(2)}</td>
                            <td>${m.unidade_medida || ''}</td>
                            <td class="text-center">
                                <button class="btn-sm btn-primary" onclick="editarMaterial(${m.id})">
                                    <i class="fas fa-edit"></i> Editar
                                </button>
                                <button class="btn-sm btn-danger" onclick="excluirMaterial(${m.id})">
                                    <i class="fas fa-trash"></i> Excluir
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        container.innerHTML = tableHTML;
        
        // Atualizar contador de materiais no badge
        const totalMateriaisElement = document.getElementById('total-materiais');
        if (totalMateriaisElement) {
            animateCounter(totalMateriaisElement, materiais.length, 1000);
        }
        
        // Atualizar info dos materiais
        const materiaisInfo = document.getElementById('materiais-info');
        if (materiaisInfo) {
            materiaisInfo.textContent = `${materiais.length} materiais encontrados`;
        }
        
        showToast(`${materiais.length} materiais carregados`, 'success');
        
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
        showToast('Erro ao carregar materiais: ' + error.message, 'error');
        
        const container = document.getElementById('tabela-materiais-container');
        if (container) {
            container.innerHTML = '<div class="pad-12 text-danger">Erro ao carregar materiais. Verifique a Conexão com o servidor.</div>';
        }
    }
}

async function carregarProdutos(page = 1, limit = 20) {
    try {
        const response = await fetch(`${API_BASE_URL}/produtos?page=${page}&limit=${limit}`);
        if (!response.ok) throw new Error('Falha ao carregar produtos');
        
        const body = await response.json();
        // API retorna body.produtos, body.rows, ou array direto
        const produtos = body.produtos || body.rows || (Array.isArray(body) ? body : []);
        const total = Number(body.total || produtos.length || 0);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        
        console.log('[carregarProdutos] Recebidos', produtos.length, 'de', total, 'produtos');
        
    // Usar o container correto da Gestão de Produtos se existir
    let container = document.getElementById('tabela-produtos-gestao-container');
    if (!container) container = document.getElementById('tabela-produtos-container');
    if (!container) return;
        
        if (!Array.isArray(produtos) || produtos.length === 0) {
            container.innerHTML = '<div class="pad-12 muted">Nenhum produto cadastrado.</div>';
            return;
        }
        
        const startIndex = ((page - 1) * limit) + 1;
        const endIndex = Math.min(total, page * limit);
        const infoLine = `<div class="info-line">Mostrando ${startIndex}–${endIndex} de ${total} produtos</div>`;
        
        let tableHTML = `
            ${infoLine}
            <table class="estoque-table">
                <thead>
                    <tr>
                        <th class="w-8pct">Código</th>
                        <th>Descrição</th>
                        <th class="w-8pct">SKU</th>
                        <th class="w-10pct">GTIN</th>
                        <th class="w-8pct">Unidade</th>
                        <th class="w-8pct text-center">Estoque</th>
                        <th class="w-12pct">Variações</th>
                        <th class="w-10pct">Custo Unit.</th>
                        <th class="w-12pct text-center">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${produtos.map(p => {
                        const codigo = p.codigo || p.codigo_produto || '';
                        const descricao = p.descricao || p.descricao_produto || '';
                        const sku = p.sku || '';
                        const gtin = p.gtin || '';
                        const unidade = p.unidade_medida || p.unidade || '';
                        const estoqueVal = Number(p.quantidade || p.estoque || p.quantidade_estoque || 0).toFixed(2);
                        const custo = p.custo_unitario || p.preco || 0;
                        
                        let variacoes = [];
                        try {
                            const variacaoRaw = p.variacao || '';
                            if (Array.isArray(variacaoRaw)) {
                                variacoes = variacaoRaw.map(s => String(s).trim()).filter(Boolean);
                            } else if (typeof variacaoRaw === 'string' && variacaoRaw.trim().startsWith('[')) {
                                variacoes = JSON.parse(variacaoRaw.trim()).map(s => String(s).trim()).filter(Boolean);
                            } else if (typeof variacaoRaw === 'string' && variacaoRaw.trim()) {
                                variacoes = [variacaoRaw.trim()];
                            }
                        } catch (e) {
                            variacoes = [];
                        }
                        
                        const variacoesDisplay = variacoes.length > 0 
                            ? variacoes.slice(0, 3).join(', ') + (variacoes.length > 3 ? '...' : '')
                            : 'N/A';
                        
                        return `
                            <tr data-id="${p.id}">
                                <td><strong>${codigo}</strong></td>
                                <td>${descricao}</td>
                                <td><span class="sku-badge">${sku}</span></td>
                                <td><span class="gtin-text">${gtin || '-'}</span></td>
                                <td>${unidade}</td>
                                <td class="text-center">${estoqueVal}</td>
                                <td title="${variacoes.join(', ')}">${variacoesDisplay}</td>
                                <td>R$ ${Number(custo).toFixed(2)}</td>
                                <td class="text-center">
                                    <button class="btn-sm btn-editar-prod" onclick="editarProduto(${p.id})">
                                        <i class="fas fa-edit"></i> Editar
                                    </button>
                                    <button class="btn-sm btn-excluir-prod" onclick="excluirProduto(${p.id})">
                                        <i class="fas fa-trash"></i> Excluir
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
        
        // Add pagination if needed
        if (totalPages > 1) {
            tableHTML += `
                <div class="pagination">
                    ${page > 1 ? `<button class="btn-sm" onclick="carregarProdutos(${page - 1})">« Anterior</button>` : ''}
                    <span>Página ${page} de ${totalPages}</span>
                    ${page < totalPages ? `<button class="btn-sm" onclick="carregarProdutos(${page + 1})">Próxima »</button>` : ''}
                </div>
            `;
        }
        
    container.innerHTML = tableHTML;
        
        // Atualizar contador de produtos no badge
        const totalProdutosElement = document.getElementById('total-produtos');
        if (totalProdutosElement) {
            animateCounter(totalProdutosElement, total, 1000);
        }
        
        // Atualizar info dos produtos
        const produtosInfo = document.getElementById('produtos-info');
        if (produtosInfo) {
            produtosInfo.textContent = `${total} produtos encontrados`;
        }
        
    showToast(`${produtos.length} produtos carregados`, 'success');
        
    } catch (error) {
        console.error('Erro ao carregar produtos:', error);
        showToast('Erro ao carregar produtos: ' + error.message, 'error');
        let container = document.getElementById('tabela-produtos-gestao-container');
        if (!container) container = document.getElementById('tabela-produtos-container');
        if (container) {
            container.innerHTML = '<div class="pad-12 text-danger">Erro ao carregar produtos. Verifique a Conexão com o servidor.</div>';
        }
    }
}

// Update counters with real data from API
async function updateCounters() {
    try {
        // Count materiais (fetch full list to compute in-stock ratio)
        try {
            const materiaisResponse = await fetch(`${API_BASE_URL}/materiais`);
            if (materiaisResponse.ok) {
                const materiais = await materiaisResponse.json();
                const totalMateriaisElement = document.getElementById('total-materiais');
                const materiaisCountEl = document.getElementById('materiais-count');
                const materiaisProgressFill = document.querySelector('.materiais-progress');
                const materiaisProgressText = document.querySelector('.status-card-modern .materiais-card .progress-text, .progress-text') || document.querySelector('.materiais-card .progress-text');

                const total = Array.isArray(materiais) ? materiais.length : 0;
                const inStock = Array.isArray(materiais) ? materiais.filter(m => Number(m.quantidade_estoque || m.estoque || 0) > 0).length : 0;
                const percentInStock = total > 0 ? Math.round((inStock / total) * 100) : 0;

                if (totalMateriaisElement) animateCounter(totalMateriaisElement, total, 1500);
                if (materiaisCountEl) animateCounter(materiaisCountEl, total, 1200);
                if (materiaisProgressFill) materiaisProgressFill.style.width = Math.min(100, Math.max(0, percentInStock)) + '%';
                if (materiaisProgressText) materiaisProgressText.textContent = `${percentInStock}% em estoque`;
            }
        } catch (errMat) {
            console.warn('Falha ao atualizar contadores de materiais:', errMat);
        }

        // Count produtos and compute % with GTIN
        try {
            // First ask for a large page to try to get most rows (works for small datasets).
            const produtosResp = await fetch(`${API_BASE_URL}/produtos?page=1&limit=10000`);
            if (produtosResp.ok) {
                const produtosBody = await produtosResp.json();
                // produtosBody may be { rows: [], total: n } or an array depending on API
                const produtosRows = Array.isArray(produtosBody) ? produtosBody : (Array.isArray(produtosBody.rows) ? produtosBody.rows : []);
                const totalFromBody = Number(produtosBody.total || produtosRows.length || 0);

                const withGTIN = produtosRows.filter(p => {
                    const gt = (p.gtin || p.GTIN || p.Gtin || '').toString().trim();
                    return gt.length >= 8; // treat 8+ digits as present (covers EAN/UPC/GTIN variants)
                }).length;

                const percentWithGTIN = totalFromBody > 0 ? Math.round((withGTIN / totalFromBody) * 100) : 0;

                const totalProdutosElement = document.getElementById('total-produtos');
                const produtosCountEl = document.getElementById('produtos-count');
                const produtosProgressFill = document.querySelector('.produtos-progress');
                const produtosProgressText = document.querySelector('.produtos-card .progress-text, .status-card-modern .produtos-card .progress-text') || document.querySelector('.produtos-card .progress-text');

                if (totalProdutosElement) animateCounter(totalProdutosElement, totalFromBody, 1500);
                if (produtosCountEl) animateCounter(produtosCountEl, totalFromBody, 1200);
                if (produtosProgressFill) produtosProgressFill.style.width = Math.min(100, Math.max(0, percentWithGTIN)) + '%';
                if (produtosProgressText) produtosProgressText.textContent = `${percentWithGTIN}% com GTIN`;
            }
        } catch (errProd) {
            console.warn('Falha ao atualizar contadores de produtos:', errProd);
        }
        
    } catch (error) {
        console.error('Erro ao atualizar contadores:', error);
    }
}

// Initialize materials view when navigated to
function initializeMaterialsView() {
    console.log('Initializing Materials View...');
    showToast('Carregando dados da Seção Materiais...', 'info');
    
    // Check if containers exist
    const materiaisContainer = document.getElementById('tabela-materiais-container');
    const produtosContainer = document.getElementById('tabela-produtos-container');
    
    console.log('Materiais container:', materiaisContainer);
    console.log('Produtos container:', produtosContainer);
    
    // Update counters with real data
    updateCounters();
    
    if (!materiaisContainer || !produtosContainer) {
        console.error('Containers not found!');
        showToast('Erro: Containers não encontrados', 'error');
        return;
    }
    
    carregarMateriais();
    carregarProdutos();
}

// Action functions for buttons (to be implemented)
window.editarMaterial = function(id) {
    console.log('?? editarMaterial chamado, redirecionando para abrirModalEditarProduto');
    // Abrir modal drawer lateral de Edição de produto
    if (typeof window.abrirModalEditarProduto === 'function') {
        window.abrirModalEditarProduto(id);
    } else {
        showToast(`Erro: Modal de Edição não encontrado`, 'error');
        console.error('? Função abrirModalEditarProduto não encontrada');
    }
};

window.excluirMaterial = function(id) {
    if (confirm('Tem certeza que deseja excluir este material?')) {
        showToast(`Material ID ${id} excluído`, 'warning');
        // TODO: Implement delete material
    }
};

window.editarProduto = function(id) {
    console.log('?? Editando produto com modal drawer lateral:', id);
    
    // Abrir modal drawer lateral profissional
    if (typeof window.abrirModalEditarProduto === 'function') {
        window.abrirModalEditarProduto(id);
    } else {
        console.error('? Função window.abrirModalEditarProduto não encontrada');
        alert('Erro: Modal de Edição não disponível');
    }
    
    /* CÓDIGO ANTIGO REMOVIDO - Buscar dados e preencher campos
    fetch(`/api/pcp/produtos/${id}`)
        .then(response => {
            if (!response.ok) throw new Error('Produto não encontrado');
            return response.json();
        })
        .then(produto => {
            // Preenche campos básicos
            ...
        */
};

// Código antigo removido e comentado acima
// A Função agora usa o modal drawer lateral profissional

window.editarProduto_OLD_BACKUP = function(id) {
    /* Backup da Função antiga - não usar
    fetch(`/api/pcp/produtos/${id}`)
        .then(response => {
            if (!response.ok) throw new Error('Produto não encontrado');
            return response.json();
        })
        .then(produto => {
            // Preenche campos básicos
            document.getElementById('edit-produto-id').value = produto.id;
            document.getElementById('edit-codigo').value = produto.codigo || '';
            document.getElementById('edit-nome').value = produto.nome || '';
            document.getElementById('edit-descricao').value = produto.descricao || '';
            document.getElementById('edit-sku').value = produto.sku || '';
            document.getElementById('edit-gtin').value = produto.gtin || '';
            document.getElementById('edit-marca').value = 'Aluforce';
            
            // Preenche novos campos (valores Padrão se não existirem)
            document.getElementById('edit-categoria').value = produto.categoria || '';
            document.getElementById('edit-tensao').value = produto.tensao || '';
            document.getElementById('edit-secao').value = produto.secao || '';
            document.getElementById('edit-isolamento').value = produto.isolamento || '';
            document.getElementById('edit-condutor').value = produto.condutor || 'aluminio';
            document.getElementById('edit-custo').value = produto.custo_unitario || '';
            document.getElementById('edit-unidade').value = produto.unidade || 'metro';
            document.getElementById('edit-peso').value = produto.peso || '';
            
            // Preenche campos de estoque
            document.getElementById('edit-quantidade').value = produto.quantidade || '0';
            document.getElementById('edit-preco').value = produto.preco || '';
            document.getElementById('edit-fornecedor').value = produto.fornecedor || '';
            document.getElementById('edit-estoque-minimo').value = produto.estoque_minimo || '0';
            document.getElementById('edit-estoque-maximo').value = produto.estoque_maximo || '100';
            
            // Atualiza barra de status do estoque
            atualizarStatusEstoque(
                parseFloat(produto.quantidade) || 0,
                parseFloat(produto.estoque_minimo) || 0,
                parseFloat(produto.estoque_maximo) || 100
            );
            
            // Mostra ID no título
            document.getElementById('modal-produto-id-display').textContent = `ID: ${produto.id}`;
            
            // Valida GTIN
            validarGTINStatus(produto.gtin);
            
            // Trata o campo Variação (JSON array)
            let variacaoText = '';
            if (produto.variacao) {
                try {
                    const variacaoArray = JSON.parse(produto.variacao);
                    variacaoText = JSON.stringify(variacaoArray, null, 2);
                    atualizarPreviewVariacao(variacaoArray);
                } catch (e) {
                    variacaoText = produto.variacao;
                }
            }
            document.getElementById('edit-variacao').value = variacaoText;
            
            // Atualiza contadores de caracteres para todos os campos
            const nomeInput = document.getElementById('edit-nome');
            const descInput = document.getElementById('edit-descricao');
            
            if (nomeInput) {
                atualizarContadorCaracteres({ target: nomeInput });
            }
            if (descInput) {
                atualizarContadorCaracteres({ target: descInput });
            }
            
            // Mostra data de última modificação
            const lastModified = produto.updated_at || produto.created_at || 'não disponível';
            document.getElementById('last-modified-info').textContent = 
                `Última modificação: ${new Date(lastModified).toLocaleString('pt-BR')}`;
            
            // Mostra o modal
            const modal = document.getElementById('modal-editar-produto');
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            
            // Foca no primeiro campo editável
            document.getElementById('edit-nome').focus();
            
        })
        .catch(error => {
            console.error('Erro ao buscar produto:', error);
            showToast('? Erro ao carregar dados do produto', 'error');
        });
        */
};

// Função para atualizar preview de variações
function atualizarPreviewVariacao(variacoes) {
    const preview = document.getElementById('variacao-preview');
    if (Array.isArray(variacoes) && variacoes.length > 0) {
        preview.innerHTML = variacoes.map(v => 
            `<span class="variacao-tag">${v}</span>`
        ).join('');
        preview.classList.add('active');
    } else {
        preview.classList.remove('active');
    }
}

// Função de ajuda para variações
window.mostrarAjudaVariacao = function() {
    showToast(`
        <i class="fas fa-clipboard-list"></i> <strong>Formato de Variações:</strong><br>
        • JSON Array: ["Item1", "Item2"]<br>
        • Exemplo cores: ["Cor: Preto", "Cor: Azul"]<br>
        • Exemplo tamanhos: ["50m", "100m", "200m"]<br>
        • Deixe vazio se não houver variações
    `, 'info', 8000);
};

window.excluirProduto = function(id) {
    console.log('??? Excluindo produto:', id);
    
    const confirmacao = confirm('Tem certeza que deseja excluir este produto?Esta Ação não pode ser desfeita.');
    
    if (confirmacao) {
        // Busca o botão que foi clicado para adicionar indicador de carregamento
        const btnExcluir = document.querySelector(`button[onclick="excluirProduto(${id})"]`);
        const textoOriginal = btnExcluir ? btnExcluir.innerHTML : '';
        
        if (btnExcluir) {
            btnExcluir.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            btnExcluir.disabled = true;
        }
        
        fetch(`/api/pcp/produtos/${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Erro ao excluir produto');
            }
            return response.json();
        })
        .then(data => {
            console.log('? Produto excluído:', data.message);
            showToast('Produto excluído com sucesso!', 'success');
            
            // Recarrega a lista de produtos
            carregarProdutos();
        })
        .catch(error => {
            console.error('? Erro ao excluir produto:', error);
            showToast('Erro ao excluir produto', 'error');
        })
        .finally(() => {
            // Restaura o botão se existir
            if (btnExcluir) {
                btnExcluir.innerHTML = textoOriginal;
                btnExcluir.disabled = false;
            }
        });
    }
};

// Make functions available globally
window.carregarMateriais = carregarMateriais;
window.carregarProdutos = carregarProdutos;
window.initializeMaterialsView = initializeMaterialsView;

// Função para gerar catálogo de produtos
window.gerarCatalogoProdutos = async function() {
    console.log('<i class="fas fa-chart-bar"></i> Gerando catálogo de produtos...');
    
    try {
        // Adiciona indicador de carregamento
        const btn = document.getElementById('btn-gerar-catalogo');
        const textoOriginal = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        btn.disabled = true;
        
        // Busca dados do catálogo
        const response = await fetch('/api/pcp/produtos/catalogo');
        if (!response.ok) throw new Error('Erro ao gerar catálogo');
        
        const dados = await response.json();
        
        // Gera HTML do catálogo
        const agora = new Date();
        const timestamp = agora.toLocaleString('pt-BR');
        
        const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Catálogo de Produtos Aluforce - GTINs</title>
    <style>
        @page { margin: 1.5cm; size: A4; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 10px; line-height: 1.3; color: #333; }
        .header { text-align: center; margin-bottom: 25px; padding: 15px; border-bottom: 3px solid #3b82f6; background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); }
        .logo { font-size: 24px; font-weight: bold; color: #1e40af; margin-bottom: 5px; }
        .subtitle { font-size: 14px; color: #64748b; margin-bottom: 3px; }
        .timestamp { font-size: 10px; color: #9ca3af; }
        .stats { display: flex; justify-content: space-between; margin-bottom: 20px; padding: 10px; background: #f1f5f9; border-radius: 8px; font-weight: 600; }
        .stats-item { text-align: center; }
        .stats-value { font-size: 16px; color: #1e40af; }
        .stats-label { font-size: 9px; color: #64748b; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 20px; }
        th { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; padding: 8px 6px; text-align: left; font-weight: 600; font-size: 9px; text-transform: uppercase; }
        td { padding: 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        tr:nth-child(even) { background: #f8fafc; }
        .id-col { width: 5%; text-align: center; font-weight: 600; }
        .codigo-col { width: 12%; font-weight: 600; color: #1e40af; }
        .nome-col { width: 35%; }
        .gtin-col { width: 15%; font-family: 'Courier New', monospace; font-weight: 600; background: #fef3c7; }
        .sku-col { width: 12%; font-size: 8px; color: #64748b; }
        .marca-col { width: 10%; font-size: 8px; }
        .gtin-highlight { background: #fbbf24; padding: 2px 4px; border-radius: 3px; font-weight: bold; }
        .codigo-badge { background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-size: 8px; font-weight: 600; }
        .footer { margin-top: 30px; padding: 15px; text-align: center; border-top: 2px solid #e2e8f0; background: #f8fafc; font-size: 9px; color: #64748b; }
        .actions { margin: 20px 0; text-align: center; }
        .btn-acao { display: inline-block; margin: 0 10px; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
        .btn-acao:hover { background: #1e40af; }
        .btn-csv { background: #059669; }
        .btn-csv:hover { background: #047857; }
        @media print { .actions { display: none; } body { -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">?? ALUFORCE</div>
        <div class="subtitle">Catálogo Completo de Produtos com GTINs (EAN-13)</div>
        <div class="timestamp">Gerado em: ${timestamp}</div>
    </div>
    
    <div class="actions">
        <a href="#" onclick="window.print(); return false;" class="btn-acao">
            ?? Imprimir PDF
        </a>
        <a href="/api/pcp/produtos/catalogo/csv" class="btn-acao btn-csv">
            <i class="fas fa-download"></i> Download CSV
        </a>
    </div>
    
    <div class="stats">
        <div class="stats-item">
            <div class="stats-value">${dados.totalProdutos}</div>
            <div class="stats-label">Total Produtos</div>
        </div>
        <div class="stats-item">
            <div class="stats-value">78968192</div>
            <div class="stats-label">Prefixo Empresa</div>
        </div>
        <div class="stats-item">
            <div class="stats-value">EAN-13</div>
            <div class="stats-label">Padrão GTIN</div>
        </div>
        <div class="stats-item">
            <div class="stats-value">100%</div>
            <div class="stats-label">Cobertura GTINs</div>
        </div>
    </div>
    
    <table>
        <thead>
            <tr>
                <th class="id-col">ID</th>
                <th class="codigo-col">Código</th>
                <th class="nome-col">Nome do Produto</th>
                <th class="gtin-col">GTIN (EAN-13)</th>
                <th class="sku-col">SKU</th>
                <th class="marca-col">Marca</th>
            </tr>
        </thead>
        <tbody>`;
        
        // Adiciona produtos
        const produtosHtml = dados.produtos.map(produto => {
            const nome = (produto.nome || '').replace(/\?/g, '²');
            return `
            <tr>
                <td class="id-col">${produto.id}</td>
                <td class="codigo-col">
                    <span class="codigo-badge">${produto.codigo}</span>
                </td>
                <td class="nome-col">${nome}</td>
                <td class="gtin-col">
                    <span class="gtin-highlight">${produto.gtin}</span>
                </td>
                <td class="sku-col">${produto.sku || '—'}</td>
                <td class="marca-col">${produto.marca}</td>
            </tr>`;
        }).join('');
        
        const htmlFooter = `
        </tbody>
    </table>
    
    <div class="footer">
        <strong>?? ALUFORCE - Cabos Elétricos de Alumínio</strong><br>
        Prefixo GTIN: 78968192 | Padrão: EAN-13 (13 dígitos)<br>
        Relatório gerado automaticamente pelo Sistema PCP em ${timestamp}<br>
        Total de ${dados.totalProdutos} produtos cadastrados com GTINs válidos
    </div>
</body>
</html>`;
        
        // Cria blob e abre em nova janela
        const htmlCompleto = htmlContent + produtosHtml + htmlFooter;
        const blob = new Blob([htmlCompleto], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        // Abre em nova janela
        const novaJanela = window.open(url, '_blank');
        if (novaJanela) {
            novaJanela.document.title = 'Catálogo Produtos Aluforce';
            showToast(`?? Catálogo gerado! ${dados.totalProdutos} produtos`, 'success');
        } else {
            showToast('? Popup bloqueado! Habilite popups para este site', 'error');
        }
        
        // Limpa URL após um tempo
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
    } catch (error) {
        console.error('? Erro ao gerar catálogo:', error);
        showToast('Erro ao gerar catálogo de produtos', 'error');
    } finally {
        // Restaura botão
        const btn = document.getElementById('btn-gerar-catalogo');
        btn.innerHTML = '<i class="fas fa-file-pdf"></i> Gerar Catálogo PDF';
        btn.disabled = false;
    }
};

// Test function to manually test loading
window.testMateriais = async function() {
    console.log('Testing materiais load...');
    
    try {
        const response = await fetch('/api/pcp/materiais');
        console.log('Response:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('Data received:', data);
            
            const container = document.getElementById('tabela-materiais-container');
            if (container) {
                container.innerHTML = `<h3>Teste - ${data.length} materiais encontrados</h3>`;
                console.log('Container updated');
            } else {
                console.error('Container not found!');
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
};

// Product Search and Details System
let currentProductId = null;

// Function to search products
async function searchProducts(query) {
    if (!query || query.trim().length < 2) {
        return [];
    }
    
    try {
        console.log('Searching for:', query);
        const response = await fetch(`${API_BASE_URL}/produtos?q=${encodeURIComponent(query.trim())}&limit=10`);
        if (!response.ok) throw new Error('Falha na busca de produtos');
        
        const data = await response.json();
        console.log('API Response:', data);
        return data.rows || [];
    } catch (error) {
        console.error('Erro na busca:', error);
        showToast('Erro ao buscar produtos: ' + error.message, 'error');
        return [];
    }
}

// Function to get detailed product information
async function getProductDetails(productId) {
    try {
        const response = await fetch(`${API_BASE_URL}/produtos/${productId}`);
        if (!response.ok) throw new Error('Produto não encontrado');
        
        const product = await response.json();
        return product;
    } catch (error) {
        console.error('Erro ao buscar detalhes:', error);
        showToast('Erro ao carregar detalhes do produto: ' + error.message, 'error');
        return null;
    }
}

// Function to open product details modal
async function openProductDetailsModal(productId) {
    console.log('Opening product details for ID:', productId);
    
    const modal = document.getElementById('product-details-modal');
    const title = document.getElementById('product-details-title');
    const body = document.getElementById('product-details-body');
    
    if (!modal || !body) return;
    
    // Store current product ID
    currentProductId = productId;
    
    // Show loading state
    body.innerHTML = `
        <div class="product-details-loading">
            <i class="fas fa-spinner fa-spin"></i> Carregando informações do produto...
        </div>
    `;
    
    // Open modal
    modal.classList.remove('hidden');
    
    // Load product details
    const product = await getProductDetails(productId);
    
    if (product) {
        title.textContent = `Detalhes: ${product.descricao || product.codigo || 'Produto'}`;
        displayProductDetails(product, body);
        showToast('Detalhes do produto carregados', 'success');
    } else {
        body.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>não foi possível carregar os detalhes do produto.</p>
            </div>
        `;
    }
}

// Function to display product details in the modal
function displayProductDetails(product, container) {
    // Parse variations
    let variacoes = [];
    try {
        const variacaoRaw = product.variacao || '';
        if (Array.isArray(variacaoRaw)) {
            variacoes = variacaoRaw.map(s => String(s).trim()).filter(Boolean);
        } else if (typeof variacaoRaw === 'string' && variacaoRaw.trim().startsWith('[')) {
            variacoes = JSON.parse(variacaoRaw.trim()).map(s => String(s).trim()).filter(Boolean);
        } else if (typeof variacaoRaw === 'string' && variacaoRaw.trim()) {
            variacoes = [variacaoRaw.trim()];
        }
    } catch (e) {
        variacoes = [];
    }
    
    const html = `
        <div class="product-details-grid">
            <div class="product-info-section">
                <h4><i class="fas fa-info-circle"></i> Informações Básicas</h4>
                <div class="info-grid">
                    <div class="info-item">
                        <label>Código:</label>
                        <span class="info-value">${product.codigo || product.codigo_produto || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Descrição:</label>
                        <span class="info-value">${product.descricao || product.descricao_produto || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Unidade de Medida:</label>
                        <span class="info-value">${product.unidade_medida || product.unidade || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Categoria:</label>
                        <span class="info-value">${product.categoria || 'N/A'}</span>
                    </div>
                </div>
            </div>
            
            <div class="product-stock-section">
                <h4><i class="fas fa-boxes"></i> Estoque e Valores</h4>
                <div class="info-grid">
                    <div class="info-item">
                        <label>Quantidade em Estoque:</label>
                        <span class="info-value stock-value">${Number(product.quantidade || product.estoque || product.quantidade_estoque || 0).toFixed(2)}</span>
                    </div>
                    <div class="info-item">
                        <label>Custo Unitário:</label>
                        <span class="info-value price-value">R$ ${Number(product.custo_unitario || product.preco || 0).toFixed(2)}</span>
                    </div>
                    <div class="info-item">
                        <label>Valor Total em Estoque:</label>
                        <span class="info-value total-value">R$ ${(Number(product.quantidade || product.estoque || 0) * Number(product.custo_unitario || product.preco || 0)).toFixed(2)}</span>
                    </div>
                </div>
            </div>
            
            <div class="product-variations-section">
                <h4><i class="fas fa-tags"></i> Variações</h4>
                <div class="variations-list">
                    ${variacoes.length > 0 ? 
                        variacoes.map(v => `<span class="variation-tag">${v}</span>`).join('') 
                        : '<span class="no-variations">Nenhuma Variação cadastrada</span>'
                    }
                </div>
            </div>
            
            <div class="product-dates-section">
                <h4><i class="fas fa-calendar-alt"></i> Datas</h4>
                <div class="info-grid">
                    <div class="info-item">
                        <label>Data de criação:</label>
                        <span class="info-value">${product.created_at ? new Date(product.created_at).toLocaleDateString('pt-BR') : 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Última Atualização:</label>
                        <span class="info-value">${product.updated_at ? new Date(product.updated_at).toLocaleDateString('pt-BR') : 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Criado por:</label>
                        <span class="info-value">${product.created_by || 'Sistema'}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// Function to close product details modal
function closeProductDetailsModal() {
    const modal = document.getElementById('product-details-modal');
    if (modal) {
        modal.classList.add('hidden');
        currentProductId = null;
    }
}

// Function to edit product from details modal
function editProductFromDetails() {
    if (currentProductId) {
        closeProductDetailsModal();
        // Use the existing product modal system
        openProductModal({id: currentProductId});
    }
}

// Enhanced search functionality
function initializeProductSearch() {
    const searchInput = document.getElementById('main-search');
    const searchResults = document.getElementById('search-inline-results');
    
    if (!searchInput || !searchResults) return;
    
    let searchTimeout;
    
    searchInput.addEventListener('input', async function() {
        const query = this.value.trim();
        
        clearTimeout(searchTimeout);
        
        if (query.length < 2) {
            searchResults.classList.remove('visible');
            searchResults.setAttribute('aria-hidden', 'true');
            return;
        }
        
        searchTimeout = setTimeout(async () => {
            await searchProductsAndDisplay(query);
        }, 300);
    });
    
    // Close results when clicking outside
    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove('visible');
            searchResults.setAttribute('aria-hidden', 'true');
        }
    });
    
    // Close results when pressing ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && searchResults.classList.contains('visible')) {
            searchResults.classList.remove('visible');
            searchResults.setAttribute('aria-hidden', 'true');
        }
    });
}

// Function to display search results
function displaySearchResults(products, container) {
    if (!products || products.length === 0) {
        container.innerHTML = '<div class="search-no-results">Nenhum produto encontrado</div>';
        container.classList.add('visible');
        container.setAttribute('aria-hidden', 'false');
        return;
    }
    
    const html = products.map(product => {
        const codigo = product.codigo || product.codigo_produto || '';
        const descricao = product.descricao || product.descricao_produto || '';
        const estoque = Number(product.quantidade || product.estoque || product.quantidade_estoque || 0).toFixed(2);
        
        return `
            <div class="search-result-item" data-product-id="${product.id}">
                <div class="result-info">
                    <div class="result-title">${codigo} - ${descricao}</div>
                    <div class="result-details">Estoque: ${estoque} | ID: ${product.id}</div>
                </div>
                <div class="result-actions">
                    <button class="btn-sm btn-primary" onclick="openProductDetailsModal(${product.id})">
                        <i class="fas fa-eye"></i> Abrir
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
    container.classList.add('visible');
    container.setAttribute('aria-hidden', 'false');
}

// Make functions globally available
window.openProductDetailsModal = openProductDetailsModal;
window.closeProductDetailsModal = closeProductDetailsModal;
window.editProductFromDetails = editProductFromDetails;
window.searchProducts = searchProducts;

// Initialize header functionality for all pages
function initializeAllPageHeaders() {
    // Initialize header buttons for materiais page
    const refreshButtonMateriais = document.getElementById('btn-refresh-header-materiais');
    if (refreshButtonMateriais) {
        refreshButtonMateriais.addEventListener('click', function() {
            const icon = this.querySelector('i');
            
            // Add rotation animation
            icon.style.transform = 'rotate(360deg)';
            icon.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            
            // Show loading state
            this.disabled = true;
            this.style.opacity = '0.7';
            
            // Simulate refresh process
            setTimeout(() => {
                // Reset animation
                icon.style.transform = 'rotate(0deg)';
                this.disabled = false;
                this.style.opacity = '1';
                
                // Show success feedback
                showToast('Materiais atualizados com sucesso!', 'success');
                
                // Reload materials if function exists
                if (typeof window.carregarMateriais === 'function') {
                    window.carregarMateriais();
                }
            }, 1500);
        });
    }

    // Initialize dark mode toggle for materiais page
    const darkModeBtnMateriais = document.getElementById('btn-dark-mode-toggle-materiais');
    if (darkModeBtnMateriais) {
        darkModeBtnMateriais.addEventListener('click', function() {
            const isDarkMode = document.body.classList.contains('dark-mode');
            toggleDarkModeFromButton(!isDarkMode);
            
            // Update icon
            const icon = document.getElementById('dark-mode-icon-materiais');
            if (icon) {
                icon.className = isDarkMode ? 'fas fa-moon' : 'fas fa-sun';
            }
        });
    }

    // Initialize header buttons for ordem de compra page
    const refreshButtonCompra = document.getElementById('btn-refresh-header-compra');
    if (refreshButtonCompra) {
        refreshButtonCompra.addEventListener('click', function() {
            const icon = this.querySelector('i');
            
            // Add rotation animation
            icon.style.transform = 'rotate(360deg)';
            icon.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            
            // Show loading state
            this.disabled = true;
            this.style.opacity = '0.7';
            
            // Simulate refresh process
            setTimeout(() => {
                // Reset animation
                icon.style.transform = 'rotate(0deg)';
                this.disabled = false;
                this.style.opacity = '1';
                
                // Show success feedback
                showToast('Ordens de compra atualizadas com sucesso!', 'success');
                
                // Reload purchase orders if function exists
                if (typeof window.carregarOrdensCompra === 'function') {
                    window.carregarOrdensCompra();
                }
                
                // Update materiais status if on that page
                updateMateriaisStatus();
            }, 1500);
        });
    }

    // Initialize dark mode toggle for compra page
    const darkModeBtnCompra = document.getElementById('btn-dark-mode-toggle-compra');
    if (darkModeBtnCompra) {
        darkModeBtnCompra.addEventListener('click', function() {
            const isDarkMode = document.body.classList.contains('dark-mode');
            toggleDarkModeFromButton(!isDarkMode);
            
            // Update icon
            const icon = document.getElementById('dark-mode-icon-compra');
            if (icon) {
                icon.className = isDarkMode ? 'fas fa-moon' : 'fas fa-sun';
            }
        });
    }

    // Initialize logout buttons for all pages
    const logoutButtonMateriais = document.getElementById('btn-logout-materiais');
    const logoutButtonCompra = document.getElementById('btn-logout-compra');
    
    [logoutButtonMateriais, logoutButtonCompra].forEach(button => {
        if (button) {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLogout();
            });
        }
    });

    // Initialize search functionality for materiais page
    const searchInputMateriais = document.getElementById('main-search-materiais');
    const searchResultsMateriais = document.getElementById('search-inline-results-materiais');
    
    if (searchInputMateriais && searchResultsMateriais) {
        let searchTimeout;
        searchInputMateriais.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            const query = this.value.trim();
            
            if (query.length < 2) {
                searchResultsMateriais.classList.remove('visible');
                searchResultsMateriais.setAttribute('aria-hidden', 'true');
                return;
            }
            
            searchTimeout = setTimeout(() => {
                // Search materials function - customize as needed
                if (typeof window.searchMaterials === 'function') {
                    window.searchMaterials(query, searchResultsMateriais);
                }
            }, 300);
        });
    }

    // Initialize search functionality for compra page
    const searchInputCompra = document.getElementById('main-search-compra');
    const searchResultsCompra = document.getElementById('search-inline-results-compra');
    
    if (searchInputCompra && searchResultsCompra) {
        let searchTimeout;
        searchInputCompra.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            const query = this.value.trim();
            
            if (query.length < 2) {
                searchResultsCompra.classList.remove('visible');
                searchResultsCompra.setAttribute('aria-hidden', 'true');
                return;
            }
            
            searchTimeout = setTimeout(() => {
                // Search purchase orders function - customize as needed
                if (typeof window.searchPurchaseOrders === 'function') {
                    window.searchPurchaseOrders(query, searchResultsCompra);
                }
            }, 300);
        });
    }
}

// Functions for Professional Product Modal
function abrirModalNovoProduto() {
    const modal = document.getElementById('modal-novo-produto');
    if (modal) {
        modal.classList.remove('hidden');
        
        // Focus no primeiro input
        setTimeout(() => {
            const firstInput = modal.querySelector('input');
            if (firstInput) firstInput.focus();
        }, 300);
        
        // Gerar SKU automático baseado no código
        const codigoInput = document.getElementById('produto-codigo');
        const skuInput = document.getElementById('produto-sku');
        
        if (codigoInput && skuInput) {
            codigoInput.addEventListener('input', function() {
                const codigo = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                skuInput.value = codigo ? `SKU-${codigo}` : '';
            });
        }
        
        // Gerar GTIN automático
        const gtinInput = document.getElementById('produto-gtin');
        if (gtinInput) {
            gtinInput.addEventListener('focus', function() {
                if (!this.value) {
                    // Prefixo da empresa + código sequencial
                    const timestamp = Date.now().toString().slice(-8);
                    this.value = `78968192${timestamp.padStart(5, '0')}`;
                    
                    // Calcular dígito verificador EAN-13
                    const digits = this.value.split('').map(Number);
                    let sum = 0;
                    for (let i = 0; i < 12; i++) {
                        sum += digits[i] * (i % 2 === 0 ? 1 : 3);
                    }
                    const checkDigit = (10 - (sum % 10)) % 10;
                    this.value = this.value + checkDigit;
                }
            });
        }
    }
}

function fecharModalNovoProduto() {
    const modal = document.getElementById('modal-novo-produto');
    if (modal) {
        modal.classList.add('hidden');
        
        // Reset form
        const form = document.getElementById('form-novo-produto');
        if (form) form.reset();
    }
}

async function salvarNovoProduto() {
    const form = document.getElementById('form-novo-produto');
    const submitBtn = document.querySelector('.btn-modern.primary');
    
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    // Loading state
    submitBtn.classList.add('loading');
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    
    try {
        const formData = new FormData(form);
        const produto = {};
        
        // Converter FormData para objeto
        for (const [key, value] of formData.entries()) {
            if (key === 'variacoes' && value) {
                produto[key] = value.split(',').map(v => v.trim()).filter(Boolean);
            } else {
                produto[key] = value || null;
            }
        }
        
        // Converter números
        ['peso', 'quantidade_estoque', 'custo_unitario', 'preco_venda'].forEach(field => {
            if (produto[field]) {
                produto[field] = parseFloat(produto[field]);
            }
        });
        
        const response = await fetch(`${API_BASE_URL}/produtos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(produto)
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Erro ao salvar produto');
        }
        
        const novoProduto = await response.json();
        
        // Sucesso
        showToast('Produto cadastrado com sucesso!', 'success');
        fecharModalNovoProduto();
        
        // Recarregar lista de produtos
        if (typeof carregarProdutos === 'function') {
            carregarProdutos();
        }
        
        // Atualizar contadores
        if (typeof updateCounters === 'function') {
            updateCounters();
        }
        
    } catch (error) {
        console.error('Erro ao salvar produto:', error);
        showToast('Erro ao salvar produto: ' + error.message, 'error');
    } finally {
        // Reset loading state
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Salvar Produto';
    }
}

// Export products to PDF
async function exportarProdutos() {
    try {
        showToast('Gerando catálogo PDF...', 'info');
        
        const response = await fetch(`${API_BASE_URL}/produtos/export-pdf`);
        if (!response.ok) {
            throw new Error('Erro ao gerar PDF');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `catalogo_produtos_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showToast('Catálogo PDF gerado com sucesso!', 'success');
        
    } catch (error) {
        console.error('Erro ao exportar produtos:', error);
        showToast('Erro ao gerar PDF: ' + error.message, 'error');
    }
}

// Expose functions globally
window.abrirModalNovoProduto = abrirModalNovoProduto;
window.fecharModalNovoProduto = fecharModalNovoProduto;
window.salvarNovoProduto = salvarNovoProduto;
window.exportarProdutos = exportarProdutos;

// Debug helper: call window.testOpenNewProductModal() from browser console to open modal and print key fields
window.testOpenNewProductModal = function() {
    try {
        abrirModalNovoProduto();
        const modal = document.getElementById('modal-novo-produto');
        if (!modal) { console.warn('modal-novo-produto not found'); return; }
        const codigo = modal.querySelector('#produto-codigo');
        const sku = modal.querySelector('#produto-sku');
        const gtin = modal.querySelector('#produto-gtin');
        console.log('Modal opened. Fields:', { codigo: codigo ? codigo.value : null, sku: sku ? sku.value : null, gtin: gtin ? gtin.value : null });
    } catch (e) {
        console.error('testOpenNewProductModal error:', e);
    }
};

// Update status counters in materiais page with modern animations
function updateMateriaisStatus() {
    const materiaisCount = document.getElementById('materiais-count');
    const produtosCount = document.getElementById('produtos-count');
    const lastUpdate = document.getElementById('last-update');
    const totalMateriaisBadge = document.getElementById('total-materiais');
    
    // Add loading state
    const statusCards = document.querySelectorAll('.status-card-modern');
    statusCards.forEach(card => card.classList.add('loading-state'));
    
    // Simulate API delay (or use real API values when available)
    setTimeout(() => {
        // Read targets from data attributes if present
        const materiaisTarget = materiaisCount && materiaisCount.dataset && materiaisCount.dataset.target ? parseInt(materiaisCount.dataset.target, 10) : 189;
        const produtosTarget = produtosCount && produtosCount.dataset && produtosCount.dataset.target ? parseInt(produtosCount.dataset.target, 10) : 238;

        if (materiaisCount) {
            animateCounter(materiaisCount, materiaisTarget, 1200);
            // Also update header badge (total-materiais) when counter completes
            setTimeout(() => {
                if (totalMateriaisBadge) totalMateriaisBadge.textContent = materiaisTarget;
            }, 1300);
        }

        if (produtosCount) {
            animateCounter(produtosCount, produtosTarget, 1200);
        }

        if (lastUpdate) {
            const now = new Date();
            const formatted = now.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            // Replace typewriter with simple fade-in for timestamps to be crisp in PDF/print
            lastUpdate.style.opacity = 0;
            lastUpdate.textContent = formatted;
            setTimeout(() => { lastUpdate.style.transition = 'opacity 300ms'; lastUpdate.style.opacity = 1; }, 50);
        }
        
        // Remove loading state
        setTimeout(() => {
            statusCards.forEach(card => card.classList.remove('loading-state'));
            
            // Trigger success animation
            triggerSuccessAnimation();
        }, 500);
        
    }, 800);
}

// Counter animation function
function animateCounter(element, target, duration) {
    let start = 0;
    const increment = target / (duration / 16);
    
    function updateCounter() {
        start += increment;
        if (start < target) {
            element.textContent = Math.floor(start);
            requestAnimationFrame(updateCounter);
        } else {
            element.textContent = target;
        }
    }
    
    updateCounter();
}

// Typewriter effect for timestamps
function typewriterEffect(element, text, speed) {
    element.textContent = '';
    let i = 0;
    
    function typeChar() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(typeChar, speed);
        }
    }
    
    typeChar();
}

// Success animation trigger
function triggerSuccessAnimation() {
    // Animate progress bars
    const progressBars = document.querySelectorAll('.progress-fill');
    progressBars.forEach((bar, index) => {
        setTimeout(() => {
            bar.style.width = bar.style.width || '0%';
            bar.style.animation = 'none';
            setTimeout(() => {
                bar.style.animation = '';
            }, 10);
        }, index * 200);
    });
    
    // Activate sync indicators
    const syncDots = document.querySelectorAll('.sync-dot');
    syncDots.forEach(dot => {
        dot.classList.add('active');
    });
    
    // Show notification
    showStatusNotification('?? Dados atualizados com sucesso!', 'success');
}

// Status notification system
function showStatusNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.status-notification');
    existingNotifications.forEach(notification => notification.remove());
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = `status-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close">×</button>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? 'linear-gradient(135deg, #10b981, #059669)' : 
                    type === 'error' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 
                    'linear-gradient(135deg, #3b82f6, #1d4ed8)'};
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        font-weight: 500;
        max-width: 300px;
    `;
    
    document.body.appendChild(notification);
    
    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    });
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 3000);
}

// Initialize page-specific features
function initializePageFeatures() {
    // Check if we're on the materiais page
    const materiaisView = document.getElementById('materiais-view');
    if (materiaisView && !materiaisView.classList.contains('hidden')) {
        updateMateriaisStatus();
        updateCounters(); // Atualizar contadores com dados reais
        
        // Initialize dashboard refresh button
        const refreshBtn = document.getElementById('refresh-dashboard');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                this.classList.add('refreshing');
                
                // Trigger status update and counter update
                updateMateriaisStatus();
                updateCounters();
                
                // Remove refreshing class after animation
                setTimeout(() => {
                    this.classList.remove('refreshing');
                }, 2000);
            });
        }
        
        // Add click handlers to cards for interactive feedback
        const statusCards = document.querySelectorAll('.status-card-modern');
        statusCards.forEach(card => {
            card.addEventListener('click', function() {
                // Add ripple effect
                const ripple = document.createElement('div');
                ripple.className = 'ripple-effect';
                ripple.style.cssText = `
                    position: absolute;
                    border-radius: 50%;
                    background: rgba(59, 130, 246, 0.3);
                    transform: scale(0);
                    animation: ripple 0.6s linear;
                    pointer-events: none;
                `;
                
                const rect = this.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = (rect.width / 2 - size / 2) + 'px';
                ripple.style.top = (rect.height / 2 - size / 2) + 'px';
                
                this.style.position = 'relative';
                this.appendChild(ripple);
                
                setTimeout(() => ripple.remove(), 600);
            });
        });
    }
    
    // Debug: Check if buttons exist
    const btnReloadMateriais = document.getElementById('btn-reload-materiais');
    const btnReloadProdutos = document.getElementById('btn-reload-produtos');
    const btnTestApi = document.getElementById('btn-test-api');
    
    console.log('Materiais buttons check:', {
        btnReloadMateriais: !!btnReloadMateriais,
        btnReloadProdutos: !!btnReloadProdutos,
        btnTestApi: !!btnTestApi
    });
    
    // Force show buttons if they exist but are hidden
    if (btnReloadMateriais) {
        btnReloadMateriais.style.display = 'flex';
        btnReloadMateriais.style.visibility = 'visible';
        console.log('Forced btn-reload-materiais to be visible');
    }
    if (btnReloadProdutos) {
        btnReloadProdutos.style.display = 'flex';
        btnReloadProdutos.style.visibility = 'visible';
        console.log('Forced btn-reload-produtos to be visible');
    }
    if (btnTestApi) {
        btnTestApi.style.display = 'flex';
        btnTestApi.style.visibility = 'visible';
        console.log('Forced btn-test-api to be visible');
    }
    
    // Update status every 30 seconds
    setInterval(() => {
        const materiaisView = document.getElementById('materiais-view');
        if (materiaisView && !materiaisView.classList.contains('hidden')) {
            updateMateriaisStatus();
        }
    }, 30000);
}

// === EVENT LISTENERS PARA MODAL DE EDIÇÃO DE PRODUTO ===
document.addEventListener('DOMContentLoaded', function() {
    // botão fechar modal
    const closeBtn = document.getElementById('close-editar-produto');
    const cancelBtn = document.getElementById('btn-cancelar-edicao');
    const modal = document.getElementById('modal-editar-produto');
    const form = document.getElementById('form-editar-produto');
    
    // Função para fechar modal
    function fecharModal() {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        form.reset();
    }
    
    // Event listeners para fechar modal
    if (closeBtn) {
        closeBtn.addEventListener('click', fecharModal);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', fecharModal);
    }
    
    // Fechar modal clicando no fundo
    modal?.addEventListener('click', function(e) {
        if (e.target === modal) {
            fecharModal();
        }
    });
    
    // Fechar modal com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            fecharModal();
        }
    });
    
    // Submit do formulário de Edição
    form?.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Remove classes de erro anteriores
        document.querySelectorAll('.form-control.error').forEach(el => {
            el.classList.remove('error');
        });
        
        const formData = new FormData(form);
        const produtoId = formData.get('id');
        
        // Valida campos obrigatórios
        const codigo = formData.get('codigo').trim();
        const nome = formData.get('nome').trim();
        
        let hasError = false;
        
        if (!codigo) {
            document.getElementById('edit-codigo').classList.add('error');
            hasError = true;
        }
        
        if (!nome) {
            document.getElementById('edit-nome').classList.add('error');
            hasError = true;
        }
        
        if (hasError) {
            showToast('?? Preencha todos os campos obrigatórios', 'error');
            return;
        }
        
        // Valida GTIN se preenchido
        const gtin = formData.get('gtin').trim();
        if (gtin && !/^\d{8,14}$/.test(gtin)) {
            document.getElementById('edit-gtin').classList.add('error');
            showToast('<i class="fas fa-hashtag"></i> GTIN deve conter apenas números (8 a 14 dígitos)', 'error');
            return;
        }
        
        // Valida Variação se preenchida
        let variacao = formData.get('variacao').trim();
        if (variacao) {
            try {
                const parsed = JSON.parse(variacao);
                if (!Array.isArray(parsed)) {
                    document.getElementById('edit-variacao').classList.add('error');
                    showToast('?? Variação deve ser um array JSON válido', 'error');
                    return;
                }
            } catch (e) {
                document.getElementById('edit-variacao').classList.add('error');
                showToast('?? Formato de Variação inválido. Use: ["Item1", "Item2"]', 'error');
                return;
            }
        }
        
        // Prepara dados para envio
        const dadosProduto = {
            codigo: codigo,
            nome: nome,
            descricao: formData.get('descricao').trim() || null,
            sku: formData.get('sku').trim() || null,
            gtin: gtin || null,
            marca: formData.get('marca').trim() || null,
            variacao: variacao || null
        };
        
        // Adiciona indicador de carregamento
        const submitBtn = form.querySelector('button[type="submit"]');
        const textoOriginal = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        submitBtn.disabled = true;
        
        // Envia requisição PUT
        fetch(`/api/pcp/produtos/${produtoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dadosProduto)
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => Promise.reject(err));
            }
            return response.json();
        })
        .then(data => {
            console.log('? Produto atualizado:', data.message);
            showToast('? Produto atualizado com sucesso!', 'success');
            
            // Fecha modal e recarrega produtos
            fecharModal();
            carregarProdutos();
        })
        .catch(error => {
            console.error('? Erro ao atualizar produto:', error);
            const mensagem = error.message || 'Erro ao atualizar produto';
            showToast(`? ${mensagem}`, 'error');
        })
        .finally(() => {
            // Restaura botão
            submitBtn.innerHTML = textoOriginal;
            submitBtn.disabled = false;
        });
    });
    
    // Validação em tempo real dos campos
    const codigoField = document.getElementById('edit-codigo');
    const nomeField = document.getElementById('edit-nome');
    const gtinField = document.getElementById('edit-gtin');
    const variacaoField = document.getElementById('edit-variacao');
    
    // Remove erro quando usuário digita
    [codigoField, nomeField, gtinField, variacaoField].forEach(field => {
        if (field) {
            field.addEventListener('input', function() {
                this.classList.remove('error');
            });
        }
    });
    
    // Validação específica do GTIN
    gtinField?.addEventListener('blur', function() {
        const value = this.value.trim();
        if (value && !/^\d{8,14}$/.test(value)) {
            this.classList.add('error');
        } else {
            this.classList.remove('error');
        }
    });
    
    // Event listeners para contadores de caracteres
    const nomeInput = document.getElementById('edit-nome');
    const descInput = document.getElementById('edit-descricao');
    const gtinInput = document.getElementById('edit-gtin');
    const variacaoInput = document.getElementById('edit-variacao');
    
    if (nomeInput) {
        nomeInput.addEventListener('input', atualizarContadorCaracteres);
    }
    
    if (descInput) {
        descInput.addEventListener('input', atualizarContadorCaracteres);
    }
    
    // Validação em tempo real do GTIN
    if (gtinInput) {
        gtinInput.addEventListener('input', function() {
            validarGTINStatus(this.value);
            this.classList.remove('error');
        });
    }
    
    // Preview de variações em tempo real
    if (variacaoInput) {
        variacaoInput.addEventListener('input', function() {
            const value = this.value.trim();
            if (value) {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) {
                        atualizarPreviewVariacao(parsed);
                        this.classList.remove('invalid');
                        this.classList.add('valid');
                    } else {
                        document.getElementById('variacao-preview').classList.remove('active');
                        this.classList.add('invalid');
                    }
                } catch (e) {
                    document.getElementById('variacao-preview').classList.remove('active');
                    this.classList.add('invalid');
                }
            } else {
                document.getElementById('variacao-preview').classList.remove('active');
                this.classList.remove('invalid', 'valid');
            }
        });
    }
    
    // botão de preview do produto
    const previewBtn = document.getElementById('btn-preview-produto');
    if (previewBtn) {
        previewBtn.addEventListener('click', function() {
            const formData = new FormData(form);
            const produtoData = {};
            
            for (let [key, value] of formData.entries()) {
                produtoData[key] = value;
            }
            
            // Mostra preview em toast
            showToast(`
                <i class="fas fa-box"></i> <strong>Preview do Produto:</strong><br>
                <i class="fas fa-tag"></i> <strong>Nome:</strong> ${produtoData.nome}<br>
                <i class="fas fa-barcode"></i> <strong>GTIN:</strong> ${produtoData.gtin}<br>
                <i class="fas fa-list"></i> <strong>Categoria:</strong> ${produtoData.categoria || 'não definida'}<br>
                <i class="fas fa-bolt"></i> <strong>Tensão:</strong> ${produtoData.tensao || 'não definida'}<br>
                <i class="fas fa-dollar-sign"></i> <strong>Custo:</strong> R$ ${produtoData.custo_unitario || '0,00'}<br>
                <i class="fas fa-cubes"></i> <strong>Estoque:</strong> ${produtoData.quantidade || '0'} ${produtoData.unidade || 'un'}<br>
                <i class="fas fa-tag"></i> <strong>Preço:</strong> R$ ${produtoData.preco || 'não definido'}<br>
                <i class="fas fa-truck"></i> <strong>Fornecedor:</strong> ${produtoData.fornecedor || 'não definido'}
            `, 'info', 8000);
        });
    }
    
    // Event listeners para campos de estoque - Atualização em tempo real
    const quantidadeInput = document.getElementById('edit-quantidade');
    const estoqueMinInput = document.getElementById('edit-estoque-minimo');
    const estoqueMaxInput = document.getElementById('edit-estoque-maximo');
    
    function atualizarStatusEstoqueRealTime() {
        const quantidade = parseFloat(quantidadeInput?.value) || 0;
        const minimo = parseFloat(estoqueMinInput?.value) || 0;
        const maximo = parseFloat(estoqueMaxInput?.value) || 100;
        
        atualizarStatusEstoque(quantidade, minimo, maximo);
    }
    
    if (quantidadeInput) {
        quantidadeInput.addEventListener('input', atualizarStatusEstoqueRealTime);
    }
    if (estoqueMinInput) {
        estoqueMinInput.addEventListener('input', atualizarStatusEstoqueRealTime);
    }
    if (estoqueMaxInput) {
        estoqueMaxInput.addEventListener('input', atualizarStatusEstoqueRealTime);
    }
});

// Call initialization when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize after a short delay to ensure all elements are loaded
    setTimeout(() => {
        initializeAllPageHeaders();
        initializePageFeatures();
    }, 100);
});

// ============================================
// FUNÇÕES AUXILIARES PARA MODAL ENRIQUECIDO
// ============================================

// Função para validar GTIN
function validarGTINStatus(gtin) {
    const statusElement = document.getElementById('gtin-status');
    
    if (!statusElement) return false;
    
    if (!gtin || gtin.length !== 13) {
        statusElement.innerHTML = '<i class="fas fa-clock text-muted"></i> Aguardando GTIN válido (13 dígitos)';
        statusElement.className = 'form-input-status';
        return false;
    }
    
    // Validação básica de dígitos
    if (!/^\d{13}$/.test(gtin)) {
        statusElement.innerHTML = '<i class="fas fa-times text-danger"></i> GTIN deve conter apenas números';
        statusElement.className = 'form-input-status invalid';
        return false;
    }
    
    // Verificação do prefixo Aluforce
    if (gtin.startsWith('78968192')) {
        statusElement.innerHTML = '<i class="fas fa-check text-success"></i> GTIN Aluforce válido';
        statusElement.className = 'form-input-status valid';
        return true;
    } else {
        statusElement.innerHTML = '<i class="fas fa-exclamation-triangle text-warning"></i> GTIN externo (não Aluforce)';
        statusElement.className = 'form-input-status warning';
        return true;
    }
}

// Função para atualizar contador de caracteres
function atualizarContadorCaracteres(event) {
    const input = event.target;
    const id = input.id;
    const maxLength = input.getAttribute('maxlength') || 255;
    const currentLength = input.value.length;
    
    const counterId = id.replace('edit-', '') + '-count';
    const counter = document.getElementById(counterId);
    
    if (counter) {
        counter.textContent = `${currentLength}/${maxLength}`;
        
        if (currentLength > maxLength * 0.8) {
            counter.classList.add('warning');
        } else {
            counter.classList.remove('warning');
        }
        
        if (currentLength >= maxLength) {
            counter.classList.add('error');
        } else {
            counter.classList.remove('error');
        }
    }
}

// Função para preview de variações
function atualizarPreviewVariacao(variacoes) {
    const preview = document.getElementById('variacao-preview');
    
    if (!preview) return;
    
    if (!variacoes || variacoes.length === 0) {
        preview.classList.remove('active');
        return;
    }
    
    const html = variacoes.map((variacao, index) => `
        <div class="variation-item">
            <span class="variation-index">${index + 1}</span>
            <div class="variation-details">
                <strong>${variacao.nome || 'Sem nome'}</strong>
                ${variacao.cor ? `<span class="badge badge-color">${variacao.cor}</span>` : ''}
                ${variacao.tamanho ? `<span class="badge badge-size">${variacao.tamanho}</span>` : ''}
                ${variacao.preco ? `<span class="badge badge-price">R$ ${variacao.preco}</span>` : ''}
            </div>
        </div>
    `).join('');
    
    preview.innerHTML = html;
    preview.classList.add('active');
}

// Função para atualizar status do estoque
function atualizarStatusEstoque(quantidade, minimo, maximo) {
    const statusFill = document.getElementById('status-fill');
    const statusText = document.getElementById('status-text');
    const statusPercentage = document.getElementById('status-percentage');
    
    if (!statusFill || !statusText || !statusPercentage) return;
    
    // Calcula a porcentagem baseada no máximo
    const porcentagem = maximo > 0 ? Math.min((quantidade / maximo) * 100, 100) : 0;
    
    // Determina o status
    let status = 'normal';
    let textoStatus = 'Estoque Normal';
    
    if (quantidade <= 0) {
        status = 'critico';
        textoStatus = 'Sem Estoque';
    } else if (quantidade <= minimo) {
        status = 'critico';
        textoStatus = 'Estoque Crítico';
    } else if (quantidade <= minimo * 1.5) {
        status = 'baixo';
        textoStatus = 'Estoque Baixo';
    } else if (quantidade >= maximo * 0.9) {
        status = 'alto';
        textoStatus = 'Estoque Alto';
    }
    
    // Atualiza visual
    statusFill.style.width = `${porcentagem}%`;
    statusFill.className = `status-fill ${status}`;
    statusText.textContent = textoStatus;
    statusText.className = `status-text ${status}`;
    statusPercentage.textContent = `${porcentagem.toFixed(1)}%`;
}

// Função para resetar modal
function resetModalEnriquecido() {
    const modal = document.getElementById('edit-modal');
    const form = document.getElementById('edit-form');
    
    if (form) {
        form.reset();
    }
    
    // Limpar status
    const statusElements = modal.querySelectorAll('.form-input-status');
    statusElements.forEach(el => {
        el.innerHTML = '';
        el.className = 'form-input-status';
    });
    
    // Limpar contadores
    const counters = modal.querySelectorAll('.char-counter');
    counters.forEach(counter => {
        counter.textContent = '0/255';
        counter.classList.remove('warning', 'error');
    });
    
    // Limpar preview
    const preview = document.getElementById('variacao-preview');
    if (preview) {
        preview.classList.remove('active');
        preview.innerHTML = '';
    }
    
    // Remover classes de Validação
    const inputs = modal.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.classList.remove('error', 'valid', 'invalid');
    });
}

// ====================== MODAL DE MATERIAIS PROFISSIONAL ======================

// Abrir Modal de Novo Material
function abrirModalNovoMaterial() {
    console.log('Abrindo modal de novo material...');
    const modal = document.getElementById('modal-material-professional');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Focar no primeiro campo
        setTimeout(() => {
            const firstInput = modal.querySelector('#material-codigo');
            if (firstInput) {
                firstInput.focus();
            }
        }, 300);
        
        // Configurar cálculo automático de margem
        setupMargemCalculation();
        
        // Configurar Validação em tempo real
        setupMaterialValidation();
    } else {
        console.error('Modal de material não encontrado');
    }
}

// Fechar Modal de Novo Material
function fecharModalNovoMaterial() {
    console.log('Fechando modal de novo material...');
    const modal = document.getElementById('modal-material-professional');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        
        // Limpar formulário
        limparFormularioMaterial();
    }
}

// Salvar Novo Material
async function salvarNovoMaterial() {
    console.log('Salvando novo material...');
    
    const form = document.getElementById('form-novo-material');
    if (!form) {
        console.error('Formulário de material não encontrado');
        return;
    }
    
    // Validar formulário
    if (!validarFormularioMaterial()) {
        console.warn('Formulário contém erros de Validação');
        return;
    }
    
    // Coletar dados do formulário
    const dadosMaterial = coletarDadosMaterial();
    
    try {
        console.log('Enviando dados do material:', dadosMaterial);
        
        const response = await fetch('/api/pcp/materiais', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(dadosMaterial)
        });
        
        if (response.ok) {
            const resultado = await response.json();
            console.log('Material salvo com sucesso:', resultado);
            
            // Mostrar mensagem de sucesso
            mostrarMensagemSucesso('Material cadastrado com sucesso!');
            
            // Fechar modal
            fecharModalNovoMaterial();
            
            // Recarregar lista de materiais se estiver na aba de materiais
            if (currentView === 'materiais') {
                carregarMateriais();
            }
            
            // Atualizar contadores
            if (typeof atualizarContadores === 'function') {
                atualizarContadores();
            }
            
        } else {
            const error = await response.json();
            console.error('Erro ao salvar material:', error);
            mostrarMensagemErro('Erro ao salvar material: ' + (error.message || 'Erro desconhecido'));
        }
        
    } catch (error) {
        console.error('Erro na requisição:', error);
        mostrarMensagemErro('Erro de Conexão. Verifique sua internet e tente novamente.');
    }
}

// Configurar Cálculo de Margem
function setupMargemCalculation() {
    const custoInput = document.getElementById('material-custo');
    const precoInput = document.getElementById('material-preco');
    const margemInput = document.getElementById('material-margem');
    
    if (custoInput && precoInput && margemInput) {
        const calcularMargem = () => {
            const custo = parseFloat(custoInput.value) || 0;
            const preco = parseFloat(precoInput.value) || 0;
            
            if (custo > 0 && preco > custo) {
                const margem = ((preco - custo) / custo * 100).toFixed(2);
                margemInput.value = margem;
            } else {
                margemInput.value = '';
            }
        };
        
        custoInput.addEventListener('input', calcularMargem);
        precoInput.addEventListener('input', calcularMargem);
    }
}

// Configurar Validação de Material
function setupMaterialValidation() {
    const form = document.getElementById('form-novo-material');
    if (!form) return;
    
    // Validação de NCM (8 dígitos)
    const ncmInput = document.getElementById('material-ncm');
    if (ncmInput) {
        ncmInput.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '').substring(0, 8);
        });
    }
    
    // Validação de campos numéricos
    const numericInputs = form.querySelectorAll('input[type="number"]');
    numericInputs.forEach(input => {
        input.addEventListener('input', function() {
            if (this.value < 0) {
                this.value = 0;
            }
        });
    });
    
    // Validação em tempo real
    const requiredInputs = form.querySelectorAll('input[required], select[required]');
    requiredInputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.value.trim() === '') {
                this.classList.add('error');
            } else {
                this.classList.remove('error');
                this.classList.add('valid');
            }
        });
    });
}

// Validar Formulário de Material
function validarFormularioMaterial() {
    const form = document.getElementById('form-novo-material');
    if (!form) return false;
    
    let isValid = true;
    const errors = [];
    
    // Campos obrigatórios
    const requiredFields = [
        { id: 'material-codigo', name: 'Código do Material' },
        { id: 'material-descricao', name: 'Descrição' },
        { id: 'material-estoque-minimo', name: 'Estoque Mínimo' },
        { id: 'material-unidade', name: 'Unidade de Medida' }
    ];
    
    requiredFields.forEach(field => {
        const input = document.getElementById(field.id);
        if (input && !input.value.trim()) {
            input.classList.add('error');
            errors.push(`${field.name} é obrigatório`);
            isValid = false;
        } else if (input) {
            input.classList.remove('error');
        }
    });
    
    // Validação específica de NCM
    const ncmInput = document.getElementById('material-ncm');
    if (ncmInput && ncmInput.value && ncmInput.value.length !== 8) {
        ncmInput.classList.add('error');
        errors.push('NCM deve ter exatamente 8 dígitos');
        isValid = false;
    }
    
    // Mostrar erros se houver
    if (errors.length > 0) {
        mostrarMensagemErro('Corrija os seguintes erros:' + errors.join(''));
    }
    
    return isValid;
}

// Coletar Dados do Material
function coletarDadosMaterial() {
    const form = document.getElementById('form-novo-material');
    const formData = new FormData(form);
    
    const dadosMaterial = {};
    
    // Coletar todos os campos
    formData.forEach((value, key) => {
        if (value.trim() !== '') {
            dadosMaterial[key] = value.trim();
        }
    });
    
    // Adicionar timestamp
    dadosMaterial.data_cadastro = new Date().toISOString();
    dadosMaterial.usuario_cadastro = window.currentUser?.nome || 'Sistema';
    
    return dadosMaterial;
}

// Limpar Formulário de Material
function limparFormularioMaterial() {
    const form = document.getElementById('form-novo-material');
    if (!form) return;
    
    // Resetar formulário
    form.reset();
    
    // Limpar classes de Validação
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.classList.remove('error', 'valid', 'invalid');
    });
    
    // Resetar margem calculada
    const margemInput = document.getElementById('material-margem');
    if (margemInput) {
        margemInput.value = '';
    }
}

// Exportar Materiais para PDF
async function exportarMateriais() {
    console.log('Iniciando exportAção de materiais para PDF...');
    
    try {
        const response = await fetch('/api/pcp/materiais/export-pdf');
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `catalogo_materiais_${new Date().toISOString().split('T')[0]}.html`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            mostrarMensagemSucesso('Catálogo de materiais exportado com sucesso!');
        } else {
            throw new Error('Erro ao gerar catálogo de materiais');
        }
    } catch (error) {
        console.error('Erro ao exportar materiais:', error);
        mostrarMensagemErro('Erro ao exportar catálogo de materiais');
    }
}

// Função auxiliar para mostrar mensagens de sucesso
function mostrarMensagemSucesso(mensagem) {
    showToast(mensagem, 'success');
}

// Função auxiliar para mostrar mensagens de erro
function mostrarMensagemErro(mensagem) {
    showToast(mensagem, 'error');
}

// ============================================
// SISTEMA DE CONFIRMAÇÃO PROFISSIONAL
// ============================================
function showConfirmModal(options = {}) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-modal-overlay');
        const icon = document.getElementById('confirm-modal-icon');
        const iconI = document.getElementById('confirm-modal-icon-i');
        const title = document.getElementById('confirm-modal-title');
        const message = document.getElementById('confirm-modal-message');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        const confirmBtn = document.getElementById('confirm-modal-confirm');
        
        if (!overlay) {
            // Fallback para confirm nativo se modal não existir
            resolve(confirm(options.message || 'Deseja continuar?'));
            return;
        }

        // Configurar tipo/tema
        const type = options.type || 'warning'; // warning, danger, info, success
        icon.className = `confirm-modal-icon ${type}`;
        
        // Configurar ícone
        const icons = {
            warning: 'fa-exclamation-triangle',
            danger: 'fa-trash-alt',
            info: 'fa-info-circle',
            success: 'fa-check-circle'
        };
        iconI.className = `fas ${icons[type] || icons.warning}`;
        
        // Configurar textos
        title.textContent = options.title || 'Confirmar Ação';
        message.textContent = options.message || 'Tem certeza que deseja continuar?';
        
        // Configurar botões
        cancelBtn.innerHTML = `<i class="fas fa-times"></i> ${options.cancelText || 'Cancelar'}`;
        confirmBtn.innerHTML = `<i class="fas fa-check"></i> ${options.confirmText || 'Confirmar'}`;
        
        // Configurar classe do botão de confirmar
        confirmBtn.className = 'confirm-modal-btn';
        if (type === 'danger') {
            confirmBtn.classList.add('confirm-modal-btn-danger');
        } else if (type === 'warning') {
            confirmBtn.classList.add('confirm-modal-btn-warning');
        } else {
            confirmBtn.classList.add('confirm-modal-btn-confirm');
        }
        
        // Handlers
        const handleConfirm = () => {
            cleanup();
            overlay.classList.remove('active');
            setTimeout(() => resolve(true), 300);
        };
        
        const handleCancel = () => {
            cleanup();
            overlay.classList.remove('active');
            setTimeout(() => resolve(false), 300);
        };
        
        const handleOverlayClick = (e) => {
            if (e.target === overlay) {
                handleCancel();
            }
        };
        
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            } else if (e.key === 'Enter') {
                handleConfirm();
            }
        };
        
        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleKeydown);
        };
        
        // Adicionar event listeners
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        overlay.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleKeydown);
        
        // Mostrar modal
        overlay.classList.add('active');
        confirmBtn.focus();
    });
}

// Alias para uso mais simples
async function confirmAction(message, options = {}) {
    return showConfirmModal({
        message,
        ...options
    });
}







