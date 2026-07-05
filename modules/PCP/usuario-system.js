// Script para gerenciar avatar e informações do usuário logado
(function() {
    'use strict';
    
    let currentUser = null;
    
    // Função para carregar informações do usuário atual
    async function carregarUsuarioLogado() {
        try {
            const response = await fetch('/api/pcp/me', {
                method: 'GET',
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                currentUser = data.user;
                console.log('👤 Usuário logado:', currentUser);
                atualizarInterfaceUsuario(currentUser);
                return currentUser;
            } else {
                console.warn('⚠️ não foi possível carregar dados do usuário');
                return null;
            }
        } catch (error) {
            console.error('❌ Erro ao carregar usuário:', error);
            return null;
        }
    }
    
    // Função para atualizar todos os elementos da interface com os dados do usuário
    function atualizarInterfaceUsuario(user) {
        if (!user) return;
        
        console.log('🔄 Atualizando interface do usuário:', user.nome);
        
        // Atualizar saudação dinâmica baseada na hora
        const greetingTextEl = document.getElementById('greeting-text');
        if (greetingTextEl) {
            const hour = new Date().getHours();
            let greeting = 'Bom dia';
            if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
            else if (hour >= 18 || hour < 5) greeting = 'Boa noite';
            greetingTextEl.textContent = greeting;
        }
        
        // Usar apelido se disponível, senão primeiro nome
        const primeiroNome = user.apelido || (user.nome ? user.nome.split(' ')[0] : 'Usuário');
        
        // Atualizar nome na saudação principal (header)
        const userNameEl = document.getElementById('user-name');
        if (userNameEl) {
            userNameEl.textContent = primeiroNome;
        }
        
        // Atualizar nome do usuário em todos os locais
        const userTexts = document.querySelectorAll('.user-text');
        userTexts.forEach(element => {
            element.textContent = `Olá, ${primeiroNome}`;
        });
        
        // Atualizar avatares com imagem
        const avatarCircles = document.querySelectorAll('.avatar-circle img');
        avatarCircles.forEach(img => {
            const avatarUrl = obterURLAvatar(user);
            img.src = avatarUrl;
            img.alt = user.nome || 'Usuário';
            
            // Fallback para quando a imagem não carregar
            img.onerror = function() {
                console.log(`⚠️ Avatar não encontrado para ${user.nome}, usando fallback`);
                this.style.display = 'none';
                
                // Criar avatar com iniciais se não existe
                let initialsDiv = this.parentElement.querySelector('.avatar-initials');
                if (!initialsDiv) {
                    initialsDiv = document.createElement('div');
                    initialsDiv.className = 'avatar-initials';
                    this.parentElement.appendChild(initialsDiv);
                }
                
                const iniciais = obterIniciais(user.nome);
                initialsDiv.textContent = iniciais;
                initialsDiv.style.cssText = `
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 600;
                    font-size: 14px;
                    text-transform: uppercase;
                `;
            };
        });
        
        // Atualizar avatares apenas com iniciais
        const userAvatars = document.querySelectorAll('.user-avatar');
        userAvatars.forEach(avatar => {
            const iniciais = obterIniciais(user.nome);
            avatar.textContent = iniciais;
            
            // Aplicar cor baseada no nome do usuário
            const cor = gerarCorAvatar(user.nome);
            avatar.style.background = cor;
        });
        
        // Atualizar informações em menus e dropdowns
        const userMenus = document.querySelectorAll('[data-user-info]');
        userMenus.forEach(element => {
            const tipo = element.getAttribute('data-user-info');
            switch(tipo) {
                case 'nome':
                    element.textContent = user.nome || 'Usuário';
                    break;
                case 'email':
                    element.textContent = user.email || '';
                    break;
                case 'role':
                    const roleLabel = user.role === 'admin' ? 'Administrador' : 
                                    user.role === 'pcp' ? 'PCP' : 'Usuário';
                    element.textContent = roleLabel;
                    break;
            }
        });
        
        console.log('✅ Interface do usuário atualizada');
    }
    
    // Função para obter URL do avatar
    function obterURLAvatar(user) {
        if (user.foto_perfil_url) {
            return user.foto_perfil_url;
        }
        
        // Tentar encontrar avatar por nome
        const nomeSimplificado = user.nome ? 
            user.nome.toLowerCase()
                .replace(/\s+/g, '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') : 'default';
        
        return `/avatars/${nomeSimplificado}.webp`;
    }
    
    // Função para obter iniciais do nome
    function obterIniciais(nome) {
        if (!nome) return 'U';
        
        const palavras = nome.trim().split(' ');
        if (palavras.length === 1) {
            return palavras[0].substring(0, 2).toUpperCase();
        }
        
        return (palavras[0].charAt(0) + palavras[palavras.length - 1].charAt(0)).toUpperCase();
    }
    
    // Função para gerar cor do avatar baseada no nome
    function gerarCorAvatar(nome) {
        if (!nome) return '#667eea';
        
        const cores = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
            'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
            'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
            'linear-gradient(135deg, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)',
            'linear-gradient(135deg, #a8caba 0%, #5d4e75 100%)',
            'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
            'linear-gradient(135deg, #fdbb2d 0%, #22c1c3 100%)'
        ];
        
        // Usar código hash do nome para selecionar cor consistente
        let hash = 0;
        for (let i = 0; i < nome.length; i++) {
            const char = nome.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        const index = Math.abs(hash) % cores.length;
        return cores[index];
    }
    
    // Função para configurar eventos de logout
    function configurarLogout() {
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', async function(e) {
                e.preventDefault();
                
                // Mostrar modal de confirmação se existir
                const logoutModal = document.getElementById('logout-modal');
                if (logoutModal) {
                    logoutModal.style.display = 'flex';
                    return;
                }
                
                // Logout direto se não houver modal
                await executarLogout();
            });
        }
        
        // Configurar botões do modal de logout se existirem
        const logoutCancel = document.getElementById('logout-cancel');
        const logoutConfirm = document.getElementById('logout-confirm');
        const logoutModal = document.getElementById('logout-modal');
        
        if (logoutCancel && logoutModal) {
            logoutCancel.addEventListener('click', function() {
                logoutModal.style.display = 'none';
            });
        }
        
        if (logoutConfirm) {
            logoutConfirm.addEventListener('click', async function() {
                if (logoutModal) {
                    logoutModal.style.display = 'none';
                }
                await executarLogout();
            });
        }
    }
    
    // Função para executar logout
    async function executarLogout() {
        try {
            const response = await fetch('/api/pcp/logout', {
                method: 'POST',
                credentials: 'include'
            });
            
            // Sempre redirecionar para login, independente da resposta
            window.location.href = window.__withBasePath ? window.__withBasePath('/login.html') : '/login.html';
        } catch (error) {
            console.error('❌ Erro no logout:', error);
            // Mesmo com erro, redirecionar para login
            window.location.href = window.__withBasePath ? window.__withBasePath('/login.html') : '/login.html';
        }
    }
    
    // Função para adicionar CSS personalizado para avatares
    function adicionarEstilosAvatar() {
        const style = document.createElement('style');
        style.textContent = `
            .avatar-circle {
                position: relative;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                overflow: hidden;
                border: 2px solid #e5e7eb;
                background: #f3f4f6;
            }
            
            .avatar-circle img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: opacity 0.3s ease;
            }
            
            .avatar-initials {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                height: 100%;
                font-weight: 600;
                font-size: 14px;
                color: white;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .user-avatar {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                font-size: 12px;
                color: white;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border: 2px solid rgba(255, 255, 255, 0.2);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
            }
            
            .user-avatar:hover {
                transform: scale(1.05);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            .user-text {
                font-weight: 500;
                color: #374151;
                margin-right: 8px;
            }
            
            @media (max-width: 768px) {
                .user-text {
                    display: none;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Função de inicializAção
    async function inicializar() {
        console.log('🚀 Inicializando sistema de usuário...');
        
        // Adicionar estilos
        adicionarEstilosAvatar();
        
        // Carregar dados do usuário
        await carregarUsuarioLogado();
        
        // Configurar eventos
        configurarLogout();
        
        console.log('✅ Sistema de usuário inicializado');
    }
    
    // Expor funções globalmente para uso em outros scripts
    window.UsuarioSystem = {
        carregarUsuario: carregarUsuarioLogado,
        atualizarInterface: atualizarInterfaceUsuario,
        getCurrentUser: () => currentUser,
        logout: executarLogout
    };
    
    // Inicializar quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }
    
})();

