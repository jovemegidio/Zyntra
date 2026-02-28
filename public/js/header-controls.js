/**
 * Controles do Header - Dark Mode, Search, Notifications
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('[Header] Inicializando controles...');
    
    // ========== DARK MODE ==========
    const darkToggle = document.getElementById('darkmode-toggle');
    const headerEl = document.querySelector('.main-header');
    const bodyEl = document.body;
    
    // Aplicar preferência salva
    try { 
        if (localStorage.getItem('darkMode') === '1') {
            if (bodyEl) bodyEl.classList.add('dark-mode');
            if (headerEl) headerEl.classList.add('dark');
            console.log('[Header] Dark mode aplicado');
        }
    } catch(e) {
        console.error('[Header] Erro ao carregar dark mode:', e);
    }
    
    if (darkToggle) {
        darkToggle.addEventListener('click', function() {
            console.log('[Header] Toggle dark mode clicked');
            if (bodyEl) bodyEl.classList.toggle('dark-mode');
            if (headerEl) headerEl.classList.toggle('dark');
            
            try { 
                const isDark = bodyEl && bodyEl.classList.contains('dark-mode');
                localStorage.setItem('darkMode', isDark ? '1' : '0');
                console.log('[Header] Dark mode:', isDark ? 'ON' : 'OFF');
            } catch(e) {
                console.error('[Header] Erro ao salvar dark mode:', e);
            }
        });
        console.log('[Header] ✅ Dark mode toggle configurado');
    }
    // Dark mode toggle não encontrado é normal em algumas páginas

    // ========== SEARCH GLOBAL INTELIGENTE ==========
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        const headerSearchContainer = document.getElementById('header-search-container');
        const headerSearchInput = document.getElementById('header-search-input');
        const headerSearchResults = document.getElementById('header-search-results');
        let searchOpen = false;
        let searchTimeout = null;
        let lastQuery = '';

        // Função para obter dados do usuário logado
        function getUsuarioLogado() {
            try {
                const userData = JSON.parse(localStorage.getItem('userData') || '{}');
                return userData;
            } catch (e) {
                return {};
            }
        }

        // Função para determinar a URL do módulo RH baseado no tipo de usuário
        function getUrlRH() {
            const user = getUsuarioLogado();
            const isAdmin = user.is_admin === 1 || user.is_admin === true || 
                           user.role === 'admin' || user.role === 'administrador';
            const email = (user.email || '').toLowerCase();
            
            // Admins e TI vão para área administrativa
            if (isAdmin || email.includes('ti@') || email.includes('admin')) {
                return '/modules/RH/public/areaadm.html';
            }
            
            // Todos os outros usuários (incluindo RH) vão para página de funcionário
            return '/modules/RH/public/funcionario.html';
        }

        // Configuração dos módulos disponíveis para busca (dinâmico)
        function getModulosDisponiveis() {
            return [
                { id: 'vendas', nome: 'Vendas', icone: 'fa-shopping-cart', cor: '#10b981', url: '/modules/Vendas/public/index.html' },
                { id: 'compras', nome: 'Compras', icone: 'fa-cart-plus', cor: '#3b82f6', url: '/modules/Compras/index.html' },
                { id: 'financeiro', nome: 'Financeiro', icone: 'fa-dollar-sign', cor: '#8b5cf6', url: '/modules/Financeiro/index.html' },
                { id: 'nfe', nome: 'Faturamento', icone: 'fa-file-invoice-dollar', cor: '#f59e0b', url: '/modules/NFe/index.html' },
                { id: 'pcp', nome: 'PCP', icone: 'fa-industry', cor: '#06b6d4', url: '/modules/PCP/index.html' },
                { id: 'rh', nome: 'Recursos Humanos', icone: 'fa-users', cor: '#ec4899', url: getUrlRH() }
            ];
        }

        function openHeaderSearch() {
            if (!headerSearchContainer) return;
            headerSearchContainer.setAttribute('aria-hidden','false');
            headerSearchContainer.classList.add('open');
            
            // Sempre mostrar módulos de navegação rápida ao abrir
            setTimeout(() => {
                showModulosSugestao();
                if (headerSearchInput) {
                    headerSearchInput.focus();
                }
            }, 50);
            
            searchOpen = true;
            console.log('[Header] Busca aberta');
        }

        function closeHeaderSearch() {
            if (!headerSearchContainer) return;
            headerSearchContainer.setAttribute('aria-hidden','true');
            headerSearchContainer.classList.remove('open');
            if (headerSearchInput) headerSearchInput.value = '';
            if (headerSearchResults) headerSearchResults.innerHTML = '';
            searchOpen = false;
            lastQuery = '';
            console.log('[Header] Busca fechada');
        }

        // Mostrar módulos como sugestões iniciais
        function showModulosSugestao() {
            if (!headerSearchResults) return;
            
            const modulosDisponiveis = getModulosDisponiveis();
            
            headerSearchResults.innerHTML = `
                <div class="search-modules-hint">
                    <div class="search-hint-title">
                        <i class="fas fa-lightbulb"></i> NAVEGAÇÃO RÁPIDA
                    </div>
                    <div class="search-modules-grid">
                        ${modulosDisponiveis.map(m => `
                            <div class="search-module-item" onclick="window.location.href='${m.url}'" style="--module-color: ${m.cor}">
                                <i class="fas ${m.icone}"></i>
                                <span>${m.nome}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="search-hint-tips">
                        <i class="fas fa-info-circle"></i>
                        Digite para buscar clientes, pedidos, notas fiscais, funcionários...
                    </div>
                </div>
            `;
        }

        // Função de busca global com debounce
        async function performGlobalSearch(query) {
            if (!query || query.length < 2) {
                showModulosSugestao();
                return;
            }

            if (query === lastQuery) return;
            lastQuery = query;

            if (headerSearchResults) {
                headerSearchResults.innerHTML = `
                    <div class="search-loading">
                        <div class="search-spinner"></div>
                        <span>Buscando "${query}"...</span>
                    </div>
                `;
            }

            try {
                const response = await fetch('/api/busca-global?q=' + encodeURIComponent(query), {
                    credentials: 'include'
                });

                if (!response.ok) throw new Error('Erro na busca');
                const data = await response.json();

                renderSearchResults(data, query);
            } catch (error) {
                console.error('[Header] Erro na busca:', error);
                if (headerSearchResults) {
                    headerSearchResults.innerHTML = `
                        <div class="search-error">
                            <i class="fas fa-exclamation-circle"></i>
                            <span>Erro ao buscar. Tente novamente.</span>
                        </div>
                    `;
                }
            }
        }

        // Renderizar resultados da busca
        function renderSearchResults(data, query) {
            if (!headerSearchResults) return;

            const resultados = data.resultados || [];
            const total = data.total || resultados.length;

            if (total === 0) {
                const modulosDisponiveis = getModulosDisponiveis();
                headerSearchResults.innerHTML = `
                    <div class="search-no-results">
                        <i class="fas fa-search"></i>
                        <span>Nenhum resultado para "${query}"</span>
                        <p>Tente termos diferentes ou navegue pelos módulos abaixo</p>
                    </div>
                    <div class="search-modules-grid compact">
                        ${modulosDisponiveis.slice(0, 4).map(m => `
                            <div class="search-module-item" onclick="window.location.href='${m.url}'" style="--module-color: ${m.cor}">
                                <i class="fas ${m.icone}"></i>
                                <span>${m.nome}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
                return;
            }

            // Agrupar por tipo
            const grupos = {};
            resultados.forEach(item => {
                const tipo = item.tipo || 'outros';
                if (!grupos[tipo]) grupos[tipo] = [];
                grupos[tipo].push(item);
            });

            // Ícones e cores por tipo
            const tipoConfig = {
                cliente: { icone: 'fa-building', cor: '#10b981', label: 'Clientes' },
                pedido: { icone: 'fa-file-alt', cor: '#3b82f6', label: 'Pedidos' },
                nfe: { icone: 'fa-file-invoice', cor: '#f59e0b', label: 'Notas Fiscais' },
                funcionario: { icone: 'fa-user-tie', cor: '#ec4899', label: 'Funcionários' },
                produto: { icone: 'fa-box', cor: '#8b5cf6', label: 'Produtos' },
                conta_pagar: { icone: 'fa-money-bill-wave', cor: '#ef4444', label: 'Contas a Pagar' },
                conta_receber: { icone: 'fa-hand-holding-usd', cor: '#22c55e', label: 'Contas a Receber' },
                fornecedor: { icone: 'fa-truck', cor: '#06b6d4', label: 'Fornecedores' },
                ordem_producao: { icone: 'fa-industry', cor: '#f97316', label: 'Ordens de Produção' },
                outros: { icone: 'fa-folder', cor: '#6b7280', label: 'Outros' }
            };

            let html = `<div class="search-results-header">
                <span>${total} resultado${total > 1 ? 's' : ''} para "${query}"</span>
            </div>`;

            for (const [tipo, items] of Object.entries(grupos)) {
                const config = tipoConfig[tipo] || tipoConfig.outros;
                html += `
                    <div class="search-group" style="--group-color: ${config.cor}">
                        <div class="search-group-header">
                            <i class="fas ${config.icone}"></i>
                            <span>${config.label}</span>
                            <span class="search-group-count">${items.length}</span>
                        </div>
                        <div class="search-group-items">
                `;
                
                items.slice(0, 5).forEach(item => {
                    const link = getItemLink(item);
                    html += `
                        <div class="search-result-item" onclick="${link ? `window.location.href='${link}'` : ''}">
                            <div class="result-icon" style="background: ${config.cor}20; color: ${config.cor}">
                                <i class="fas ${config.icone}"></i>
                            </div>
                            <div class="result-info">
                                <div class="result-title">${highlightText(item.titulo || item.nome || 'Item', query)}</div>
                                <div class="result-subtitle">${item.subtitulo || item.descricao || ''}</div>
                            </div>
                            ${item.valor ? `<div class="result-value">R$ ${formatCurrency(item.valor)}</div>` : ''}
                        </div>
                    `;
                });

                if (items.length > 5) {
                    html += `<div class="search-show-more">Ver mais ${items.length - 5} resultados...</div>`;
                }

                html += '</div></div>';
            }

            headerSearchResults.innerHTML = html;
        }

        // Obter link para o item
        function getItemLink(item) {
            const tipo = item.tipo || '';
            const id = item.id;
            
            const links = {
                cliente: `/Vendas/index.html?cliente=${id}`,
                pedido: `/Vendas/index.html?pedido=${id}`,
                nfe: `/modules/NFe/index.html?nfe=${id}`,
                funcionario: `/RecursosHumanos/funcionarios.html?funcionario=${id}`,
                produto: `/modules/PCP/index.html?produto=${id}`,
                conta_pagar: `/modules/Financeiro/index.html?conta_pagar=${id}`,
                conta_receber: `/modules/Financeiro/index.html?conta_receber=${id}`,
                fornecedor: `/modules/Compras/index.html?fornecedor=${id}`,
                ordem_producao: `/modules/PCP/ordens-producao.html?ordem=${id}`
            };
            
            return links[tipo] || item.url || null;
        }

        // Destacar texto encontrado
        function highlightText(text, query) {
            if (!text || !query) return text || '';
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return String(text).replace(regex, '<mark>$1</mark>');
        }

        // Formatar moeda
        function formatCurrency(value) {
            return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        searchBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!searchOpen) openHeaderSearch(); else closeHeaderSearch();
        });

        // Removido: não fecha mais ao clicar fora - sugestões e barra são integrados

        // Busca enquanto digita com debounce
        if (headerSearchInput) {
            headerSearchInput.addEventListener('input', function(e) {
                const q = e.target.value.trim();
                
                if (searchTimeout) clearTimeout(searchTimeout);
                
                if (q.length < 2) {
                    showModulosSugestao();
                    return;
                }
                
                searchTimeout = setTimeout(() => performGlobalSearch(q), 300);
            });

            headerSearchInput.addEventListener('keydown', function(ev) {
                if (ev.key === 'Escape') {
                    closeHeaderSearch();
                } else if (ev.key === 'Enter') {
                    ev.preventDefault();
                    const q = headerSearchInput.value.trim();
                    if (q.length >= 2) {
                        performGlobalSearch(q);
                    }
                }
            });
        }
        
        console.log('[Header] ✅ Busca Global Inteligente configurada');
    } else {
        console.warn('[Header] ⚠️ Botão de busca não encontrado');
    }

    // ========== NOTIFICATIONS ==========
    const notifBtn = document.getElementById('notifications-btn');
    if (notifBtn) {
        notifBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('[Header] Notificações clicked');
            // Verificar se o NotificationManager existe
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.togglePanel();
            } else {
                console.warn('[Header] NotificationManager não disponível');
            }
        });
        console.log('[Header] ✅ Notificações configuradas');
    } else {
        console.warn('[Header] ⚠️ Botão de notificações não encontrado');
    }

    // ========== PROFILE DROPDOWN ==========
    const profileBtn = document.querySelector('.user-profile-header');
    const profileDropdown = document.getElementById('user-dropdown');
    
    if (profileBtn && profileDropdown) {
        let dropdownOpen = false;
        
        profileBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdownOpen = !dropdownOpen;
            profileDropdown.classList.toggle('show', dropdownOpen);
            console.log('[Header] Profile dropdown:', dropdownOpen ? 'ABERTO' : 'FECHADO');
        });
        
        // Fechar ao clicar fora
        document.addEventListener('click', function(e) {
            if (dropdownOpen && !profileDropdown.contains(e.target) && !profileBtn.contains(e.target)) {
                dropdownOpen = false;
                profileDropdown.classList.remove('show');
                console.log('[Header] Profile dropdown fechado (click fora)');
            }
        });
        
        console.log('[Header] ✅ Profile dropdown configurado');
    } else {
        console.warn('[Header] ⚠️ Profile dropdown não encontrado');
    }

    // ========== PROFILE MODAL ==========
    const profileOption = document.getElementById('profile-option');
    if (profileOption) {
        profileOption.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('[Header] Abrindo modal de perfil');
            
            // Usar função global do profile-modal.js
            if (typeof window.openProfileModal === 'function') {
                window.openProfileModal();
            } else {
                // Fallback se ainda não carregou
                const profileModal = document.getElementById('profile-modal');
                if (profileModal) {
                    profileModal.setAttribute('aria-hidden', 'false');
                    profileModal.style.display = 'flex';
                }
            }
            
            // Fechar dropdown
            if (profileDropdown) {
                profileDropdown.classList.remove('show');
            }
        });
        console.log('[Header] ✅ Profile modal configurado');
    }

    // ========== LOGOUT ==========
    const logoutOption = document.getElementById('logout-option');
    if (logoutOption) {
        logoutOption.addEventListener('click', async function(e) {
            e.preventDefault();
            console.log('[Header] 🚪 Logout iniciado');
            
            try {
                // Limpar cookie no servidor
                await fetch('/api/logout', { 
                    method: 'POST', 
                    credentials: 'include' 
                });
                console.log('[Header] ✅ Cookie limpo no servidor');
            } catch (error) {
                console.error('[Header] Erro ao fazer logout no servidor:', error);
            }
            
            // Limpar dados locais (centralizado)
            try {
                if (window.AluforceAuth && typeof AluforceAuth.clearAuth === 'function') {
                    AluforceAuth.clearAuth();
                } else {
                    ['authToken','token','userData','user','user_data','userName','preferred_background','darkMode','chatSupportUser','chatSupportConversations','chatSupportTickets','chatUser','supportTickets','chatVoiceEnabled'].forEach(k => {
                        try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {}
                    });
                }
            } catch (e) { console.warn('[Header] Falha ao limpar dados locais', e); }
            console.log('[Header] ✅ Dados locais limpos');
            
            // Redirecionar para login
            console.log('[Header] ↩️ Redirecionando para login...');
            setTimeout(() => { window.location.href = '/login.html'; }, 150);
        });
        console.log('[Header] ✅ Logout configurado');
    } else {
        console.warn('[Header] ⚠️ Botão de logout não encontrado');
    }

    console.log('[Header] ✅ Todos os controles inicializados');
});
