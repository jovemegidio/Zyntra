/**
 * Financeiro User Loader v3.0
 * Carrega informações do usuário logado nas páginas do módulo Financeiro
 * Suporta foto do perfil via API /api/me
 */

(function() {
    'use strict';

    // Buscar dados do usuário do localStorage
    function getUserDataFromStorage() {
        try {
            const userData = localStorage.getItem('userData');
            return userData ? JSON.parse(userData) : null;
        } catch (e) {
            return null;
        }
    }

    // Carregar informações do usuário
    async function loadUserInfo() {
        console.log('🔄 [Financeiro] Carregando dados do usuário...');
        
        // Sempre buscar da API primeiro para garantir dados atualizados
        let user = null;
        
        try {
            const response = await fetch('/api/me', { 
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (response.ok) {
                user = await response.json();
                // Salvar no localStorage para uso futuro
                localStorage.setItem('userData', JSON.stringify(user));
            }
        } catch (error) {
            console.warn('⚠️ [Financeiro] Erro ao carregar usuário da API:', error);
        }
        
        // Fallback para localStorage
        if (!user) {
            user = getUserDataFromStorage();
        }

        if (user) {
            updateUserDisplay(user);
        } else {
            // Dados padrão se não conseguir carregar
            updateUserDisplay({
                nome: 'Usuário',
                email: '',
                avatar: null,
                foto: null
            });
        }
    }

    // Atualizar exibição do usuário no header
    function updateUserDisplay(user) {
        const userName = user.apelido || user.nome || 'Usuário';
        const primeiroNome = userName.split(' ')[0];
        const inicial = primeiroNome.charAt(0).toUpperCase();
        
        // Determinar foto/avatar do usuário (prioridade: foto > avatar > foto_perfil_url)
        const fotoUrl = user.foto || user.avatar || user.foto_perfil_url;
        const temFotoValida = fotoUrl && 
                             fotoUrl !== '/avatars/default.webp' && 
                             fotoUrl !== '' && 
                             fotoUrl !== 'null' &&
                             !fotoUrl.includes('undefined');
        
        // Atualizar nome do usuário
        const userNameEl = document.getElementById('user-name');
        if (userNameEl) {
            userNameEl.textContent = primeiroNome;
        }
        
        // Atualizar foto do usuário
        const userPhotoEl = document.getElementById('user-photo');
        const userInitialEl = document.getElementById('user-initials') || document.getElementById('user-initial');
        const userAvatarEl = document.getElementById('user-avatar');
        
        if (temFotoValida && userPhotoEl) {
            userPhotoEl.src = fotoUrl;
            userPhotoEl.alt = userName;
            userPhotoEl.classList.add('visible');
            userPhotoEl.style.display = 'block';
            userPhotoEl.style.width = '100%';
            userPhotoEl.style.height = '100%';
            userPhotoEl.style.objectFit = 'cover';
            userPhotoEl.style.borderRadius = '50%';
            
            // Ocultar inicial se foto carregou
            if (userInitialEl) {
                userInitialEl.style.display = 'none';
            }
            
            // Fallback se a imagem falhar
            userPhotoEl.onerror = function() {
                this.style.display = 'none';
                this.classList.remove('visible');
                if (userInitialEl) {
                    userInitialEl.textContent = inicial;
                    userInitialEl.style.display = 'flex';
                }
            };
        } else if (userInitialEl) {
            // Mostrar apenas inicial se não tiver foto
            userInitialEl.textContent = inicial;
            userInitialEl.style.display = 'flex';
            if (userPhotoEl) userPhotoEl.style.display = 'none';
        }
        
        // Atualizar elementos .user-avatar que podem ter imagem
        const userAvatars = document.querySelectorAll('.user-avatar');
        userAvatars.forEach(avatar => {
            let img = avatar.querySelector('img');
            const span = avatar.querySelector('span, .user-initial');
            
            if (temFotoValida) {
                if (!img) {
                    img = document.createElement('img');
                    img.style.cssText = 'width: 100%; height: 100%; border-radius: 50%; object-fit: cover;';
                    avatar.insertBefore(img, avatar.firstChild);
                }
                img.src = fotoUrl;
                img.alt = userName;
                img.style.display = 'block';
                img.classList.add('visible');
                img.onerror = function() {
                    this.style.display = 'none';
                    if (span) {
                        span.textContent = inicial;
                        span.style.display = 'flex';
                    }
                };
                if (span) span.style.display = 'none';
            } else {
                if (img) img.style.display = 'none';
                if (span) {
                    span.textContent = inicial;
                    span.style.display = 'flex';
                }
            }
        });
        
        console.log('✅ [Financeiro] Usuário carregado:', primeiroNome, '| Foto:', temFotoValida ? fotoUrl : 'sem foto');
    }

    // Executar quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadUserInfo);
    } else {
        loadUserInfo();
    }
    
    // Expor funções globalmente
    window.FinanceiroUserLoader = {
        init: loadUserInfo,
        refresh: loadUserInfo
    };
})();
