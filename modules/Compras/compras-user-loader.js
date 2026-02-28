/**
 * Módulo Compras - Carregador de Usuário
 * Script para carregar e exibir dados do usuário logado em todas as páginas do módulo
 */

(function() {
    'use strict';
    
    // Executar quando DOM estiver pronto
    document.addEventListener('DOMContentLoaded', function() {
        initUserHeader();
    });

    /**
     * Inicializa o header com dados do usuário
     */
    async function initUserHeader() {
        console.log('🔄 [Compras] Inicializando header do usuário...');
        
        // Sempre buscar da API primeiro para garantir dados atualizados
        let userData = await fetchUserData();
        
        // Se falhar, tentar localStorage como fallback
        if (!userData) {
            userData = getUserDataFromStorage();
        }
        
        if (userData) {
            updateUserHeader(userData);
        } else {
            // Dados padrão se não conseguir carregar
            updateUserHeader({
                nome: 'Usuário',
                email: '',
                avatar: '/avatars/default.webp',
                cargo: 'Colaborador'
            });
        }
    }

    /**
     * Busca dados do usuário da API
     */
    async function fetchUserData() {
        try {
            const token = localStorage.getItem('token');
            const headers = {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const response = await fetch('/api/me', {
                method: 'GET',
                credentials: 'include',
                headers: headers
            });
            
            if (response.ok) {
                const userData = await response.json();
                // Salvar no localStorage para uso futuro
                localStorage.setItem('userData', JSON.stringify(userData));
                return userData;
            }
        } catch (error) {
            console.warn('⚠️ [Compras] Erro ao buscar dados do usuário:', error);
        }
        return null;
    }

    /**
     * Obtém dados do usuário do localStorage
     */
    function getUserDataFromStorage() {
        try {
            const userData = localStorage.getItem('userData');
            return userData ? JSON.parse(userData) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Atualiza o header com dados do usuário
     */
    function updateUserHeader(userData) {
        // Usar apelido se disponível, senão primeiro nome
        const userName = userData.apelido || userData.nome || 'Usuário';
        const primeiroNome = userData.apelido || (userData.nome ? userData.nome.split(' ')[0] : 'Usuário');
        const fotoUrl = userData.foto || userData.avatar || '/avatars/default.webp';
        const inicial = primeiroNome ? primeiroNome[0].toUpperCase() : 'U';
        
        // Atualizar saudação dinmica baseada na hora
        const hour = new Date().getHours();
        let greeting = 'Bom dia';
        if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
        else if (hour >= 18 || hour < 5) greeting = 'Boa noite';
        
        // Saudação - múltiplos seletores (kebab-case e camelCase)
        const greetingSelectors = ['greeting-text', 'greetingText'];
        greetingSelectors.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = greeting;
        });
        
        // Nome do usuário - múltiplos seletores
        const userNameSelectors = ['user-name', 'userName', 'userGreeting'];
        userNameSelectors.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // Para userGreeting, atualizar texto completo "Olá, Nome"
                if (id === 'userGreeting') {
                    el.textContent = `Olá, ${primeiroNome}`;
                } else {
                    el.textContent = primeiroNome;
                }
            }
        });
        
        // Atualizar .user-text (usado em algumas páginas)
        const userTextElements = document.querySelectorAll('.user-text');
        userTextElements.forEach(el => {
            el.textContent = primeiroNome;
        });
        
        // Avatar do usuário - usar innerHTML igual ao index.html
        const avatarSelectors = ['user-avatar', 'userAvatar'];
        avatarSelectors.forEach(id => {
            const avatarEl = document.getElementById(id);
            if (avatarEl) {
                // Verificar se tem foto válida
                if (fotoUrl && fotoUrl !== '/avatars/default.webp' && !fotoUrl.includes('undefined') && !fotoUrl.includes('null')) {
                    const img = document.createElement('img');
                    img.alt = primeiroNome;
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
                    img.onload = function() {
                        this.classList.add('loaded', 'visible');
                    };
                    img.onerror = function() {
                        // Fallback: mostrar iniciais quando imagem falha (404, etc)
                        this.remove();
                        const span = avatarEl.querySelector('.user-initial');
                        if (span) span.style.display = 'flex';
                        else avatarEl.innerHTML = '<span class="user-initial" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">' + inicial + '</span>';
                    };
                    img.src = fotoUrl;
                    avatarEl.innerHTML = '';
                    avatarEl.appendChild(img);
                    // Adicionar span de fallback oculto
                    const fallbackSpan = document.createElement('span');
                    fallbackSpan.className = 'user-initial';
                    fallbackSpan.textContent = inicial;
                    fallbackSpan.style.display = 'none';
                    avatarEl.appendChild(fallbackSpan);
                } else {
                    // Sem foto, mostrar iniciais com estilo
                    avatarEl.innerHTML = '<span class="user-initial" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">' + inicial + '</span>';
                }
            }
        });
        
        // Atualizar avatar do usuário (para elementos com imagem dentro de .avatar-circle)
        const avatarImages = document.querySelectorAll('.avatar-circle img');
        avatarImages.forEach(img => {
            img.src = fotoUrl;
            img.alt = userData.nome || 'Usuário';
            img.onerror = function() {
                this.onerror = null;
                this.src = '/avatars/default.webp';
            };
        });
        
        // Atualizar elementos .user-avatar que podem ter imagem ou usar iniciais
        const userAvatars = document.querySelectorAll('.user-avatar');
        userAvatars.forEach(avatar => {
            // Verificar se já tem uma tag img dentro
            let existingImg = avatar.querySelector('img');
            
            if (fotoUrl && fotoUrl !== '/avatars/default.webp') {
                if (existingImg) {
                    existingImg.src = fotoUrl;
                    existingImg.alt = userData.nome || 'Usuário';
                    existingImg.style.display = 'block';
                    existingImg.classList.add('visible');
                    existingImg.onerror = function() {
                        this.onerror = null;
                        this.src = '/avatars/default.webp';
                    };
                    // Esconder span de iniciais se existir
                    const spanInitial = avatar.querySelector('span');
                    if (spanInitial) spanInitial.style.display = 'none';
                } else {
                    // Criar imagem se não existir
                    const newImg = document.createElement('img');
                    newImg.src = fotoUrl;
                    newImg.alt = userData.nome || 'Usuário';
                    newImg.style.cssText = 'width: 100%; height: 100%; border-radius: 50%; object-fit: cover;';
                    newImg.onerror = function() {
                        this.onerror = null;
                        this.src = '/avatars/default.webp';
                    };
                    avatar.insertBefore(newImg, avatar.firstChild);
                    // Esconder iniciais
                    const spanInitial = avatar.querySelector('span');
                    if (spanInitial) spanInitial.style.display = 'none';
                }
            }
        });
        
        // Atualizar userAvatar (padrão dos dashboards)
        const userAvatarById = document.getElementById('userAvatar');
        if (userAvatarById) {
            let img = userAvatarById.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                img.style.cssText = 'width: 100%; height: 100%; border-radius: 50%; object-fit: cover;';
                userAvatarById.insertBefore(img, userAvatarById.firstChild);
            }
            img.src = fotoUrl;
            img.alt = userData.nome || 'Usuário';
            img.onerror = function() {
                this.onerror = null;
                this.src = '/avatars/default.webp';
            };
        }
        
        // Atualizar avatar externo (ui-avatars.com) para usar foto real
        const externalAvatars = document.querySelectorAll('img[src*="ui-avatars.com"]');
        externalAvatars.forEach(img => {
            if (fotoUrl && fotoUrl !== '/avatars/default.webp') {
                img.src = fotoUrl;
                img.onerror = function() {
                    this.onerror = null;
                    this.src = '/avatars/default.webp';
                };
            }
        });
        
        // Atualizar nome/role no dropdown (se existir)
        const userNameDropdown = document.querySelector('.user-name');
        const userRoleDropdown = document.querySelector('.user-role');
        
        if (userNameDropdown) {
            userNameDropdown.textContent = userData.nome || 'Usuário';
        }
        
        if (userRoleDropdown) {
            userRoleDropdown.textContent = userData.cargo || userData.role || 'Colaborador';
        }
        
        console.log('✅ [Compras] Header atualizado com dados do usuário:', userData.nome);
    }

    /**
     * Toggle do menu do usuário
     */
    window.toggleUserMenu = function() {
        const dropdown = document.getElementById('user-menu-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('active');
        }
    };

    // Fechar menu ao clicar fora
    document.addEventListener('click', function(e) {
        const userMenu = document.querySelector('.user-menu');
        const dropdown = document.getElementById('user-menu-dropdown');
        
        if (dropdown && dropdown.classList.contains('active')) {
            if (!userMenu || !userMenu.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        }
    });

    // Expor funções globalmente
    window.ComprasUserLoader = {
        init: initUserHeader,
        refresh: fetchUserData,
        update: updateUserHeader
    };
})();
