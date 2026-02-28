/**
 * Carregador de Usuário Global - ALUFORCE
 * Script universal para carregar dados do usuário logado em todas as páginas
 * Inclui: Saudação dinmica, Nome, Avatar (foto ou iniciais)
 */

(function() {
    'use strict';
    
    // Evitar execução duplicada
    if (window._userLoaderInitialized) {
        console.log('[UserLoader] Já inicializado');
        return;
    }
    window._userLoaderInitialized = true;
    
    // Executar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUserLoader);
    } else {
        initUserLoader();
    }
    
    async function initUserLoader() {
        console.log('[UserLoader] 🔄 Inicializando carregamento de usuário...');
        
        try {
            const userData = await fetchUserData();
            if (userData) {
                updateUserUI(userData);
                console.log('[UserLoader] ✅ Usuário carregado:', userData.nome);
            }
        } catch (error) {
            console.error('[UserLoader] ❌ Erro ao carregar usuário:', error);
        }
    }
    
    async function fetchUserData() {
        try {
            // Obter token
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            
            const response = await fetch('/api/me', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    ...headers,
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.warn('[UserLoader] Erro ao buscar dados:', error);
        }
        return null;
    }
    
    function updateUserUI(user) {
        // Nome do usuário (usar apelido se disponível, senão primeiro nome)
        const nomeCompleto = user.apelido || user.nome || 'Usuário';
        const primeiroNome = nomeCompleto.split(' ')[0];
        const inicial = primeiroNome.charAt(0).toUpperCase();
        
        // Foto do usuário (API retorna em avatar, foto ou foto_perfil_url)
        const fotoUrl = user.avatar || user.foto || user.foto_perfil_url || user.foto_url;
        const temFotoValida = fotoUrl && 
                             fotoUrl !== '/avatars/default.webp' && 
                             !fotoUrl.includes('undefined') &&
                             !fotoUrl.includes('null');
        
        // Atualizar saudação dinmica
        const hour = new Date().getHours();
        let saudacao = 'Bom dia';
        if (hour >= 12 && hour < 18) saudacao = 'Boa tarde';
        else if (hour >= 18 || hour < 5) saudacao = 'Boa noite';
        
        // ============ ATUALIZAR ELEMENTOS DE SAUDAÇÍO ============
        const greetingIds = ['greeting-text', 'greetingText', 'saudacao'];
        greetingIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = saudacao;
        });
        
        // ============ ATUALIZAR ELEMENTOS DE NOME ============
        const nameIds = ['user-name', 'userName', 'userGreeting', 'user-text'];
        nameIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === 'userGreeting') {
                    el.textContent = `Olá, ${primeiroNome}`;
                } else {
                    el.textContent = primeiroNome;
                }
            }
        });
        
        // Também atualizar por classe
        document.querySelectorAll('.user-text, .user-name-text').forEach(el => {
            el.textContent = primeiroNome;
        });
        
        // ============ ATUALIZAR AVATAR ============
        // Seletores para elementos de foto
        const photoIds = ['user-photo', 'userPhoto', 'user-avatar-img'];
        const initialIds = ['user-initial', 'userInitial', 'user-initials', 'userInitials'];
        
        // Atualizar foto
        photoIds.forEach(id => {
            const img = document.getElementById(id);
            if (img && img.tagName === 'IMG') {
                if (temFotoValida) {
                    img.src = fotoUrl;
                    img.alt = primeiroNome;
                    img.style.display = 'block';
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '50%';
                    img.style.position = 'absolute';
                    img.style.top = '0';
                    img.style.left = '0';
                    
                    img.onload = function() {
                        this.classList.add('visible', 'loaded');
                        // Esconder iniciais quando foto carregar
                        initialIds.forEach(initId => {
                            const initEl = document.getElementById(initId);
                            if (initEl) initEl.style.display = 'none';
                        });
                    };
                    
                    img.onerror = function() {
                        this.style.display = 'none';
                        this.classList.remove('visible', 'loaded');
                        // Mostrar iniciais se foto falhar
                        initialIds.forEach(initId => {
                            const initEl = document.getElementById(initId);
                            if (initEl) {
                                initEl.style.display = 'flex';
                                initEl.textContent = inicial;
                            }
                        });
                    };
                } else {
                    img.style.display = 'none';
                }
            }
        });
        
        // Atualizar iniciais
        initialIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = inicial;
                // Se não tem foto válida, garantir que iniciais estão visíveis
                if (!temFotoValida) {
                    el.style.display = 'flex';
                }
            }
        });
        
        // Também procurar por elementos genéricos de avatar
        document.querySelectorAll('.user-avatar').forEach(avatar => {
            const img = avatar.querySelector('img');
            const span = avatar.querySelector('span');
            
            if (img && temFotoValida) {
                img.src = fotoUrl;
                img.alt = primeiroNome;
                img.style.display = 'block';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                
                img.onload = function() {
                    this.classList.add('visible', 'loaded');
                    if (span) span.style.display = 'none';
                };
                
                img.onerror = function() {
                    this.style.display = 'none';
                    if (span) {
                        span.style.display = 'flex';
                        span.textContent = inicial;
                    }
                };
            } else if (span) {
                span.textContent = inicial;
                span.style.display = 'flex';
                if (img) img.style.display = 'none';
            }
        });
        
        // Salvar no localStorage para cache
        try {
            localStorage.setItem('userData', JSON.stringify({
                nome: user.nome,
                apelido: user.apelido,
                foto: fotoUrl,
                email: user.email,
                _timestamp: Date.now()
            }));
        } catch (e) { /* ignore */ }
    }
    
    // Expor função para uso manual
    window.reloadUserData = initUserLoader;
    
})();
