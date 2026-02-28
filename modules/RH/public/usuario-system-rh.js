// Script para gerenciar avatar e informações do usuário logado - Módulo RH
(function() {
    'use strict';
    
    let currentUser = null;
    
    // Detectar módulo automaticamente baseado na URL
    function detectarModulo() {
        const path = window.location.pathname;
        if (path.includes('/modules/RH') || path.includes('/rh/')) {
            return 'rh';
        } else if (path.includes('/modules/PCP') || path.includes('/pcp/')) {
            return 'pcp';
        }
        // Default para PCP se náo detectado
        return 'pcp';
    }
    
    // Funçáo para carregar informações do usuário atual
    async function carregarUsuarioLogado() {
        try {
            const modulo = detectarModulo();
            const endpoint = `/api/${modulo}/me`;
            
            console.log(`🔄 [${modulo.toUpperCase()}] Iniciando carregamento de usuário...`);
            console.log(`🔍 URL do endpoint: ${endpoint}`);
            
            const response = await fetch(endpoint, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('📡 Status da resposta:', response.status);
            console.log('📡 Response OK?', response.ok);
            
            if (response.ok) {
                const data = await response.json();
                console.log('📦 Dados recebidos:', data);
                
                currentUser = data.user || data;
                console.log('👤 Usuário logado:', currentUser);
                
                if (currentUser) {
                    console.log('✅ Usuário válido:', {
                        id: currentUser.id,
                        nome: currentUser.nome,
                        email: currentUser.email,
                        avatar: currentUser.avatar,
                        foto_perfil_url: currentUser.foto_perfil_url
                    });
                    atualizarInterfaceUsuario(currentUser);
                    return currentUser;
                } else {
                    console.error('❌ Campo "user" náo encontrado na resposta');
                    return null;
                }
            } else {
                const errorText = await response.text();
                console.warn('⚠️ Náo foi possível carregar dados do usuário');
                console.warn('⚠️ Status:', response.status, response.statusText);
                console.warn('⚠️ Resposta:', errorText);
                return null;
            }
        } catch (error) {
            console.error('❌ Erro ao carregar usuário:', error);
            console.error('❌ Stack trace:', error.stack);
            return null;
        }
    }
    
    // Funçáo para atualizar todos os elementos da interface com os dados do usuário
    function atualizarInterfaceUsuario(user) {
        if (!user) {
            console.warn('⚠️ atualizarInterfaceUsuario: user é null/undefined');
            return;
        }
        
        console.log('🔄 Atualizando interface do usuário:', user.nome);
        
        // Atualizar nome do usuário em todos os locais
        const userTexts = document.querySelectorAll('.user-text');
        console.log(`📝 Encontrados ${userTexts.length} elementos .user-text`);
        userTexts.forEach(element => {
            const primeiroNome = user.nome ? user.nome.split(' ')[0] : 'Usuário';
            element.textContent = `Olá, ${primeiroNome}`;
            console.log(`✏️ Atualizado .user-text: "${element.textContent}"`);
        });
        
        // Atualizar nome completo
        const userNames = document.querySelectorAll('.user-name, #user-name, #userName');
        console.log(`📝 Encontrados ${userNames.length} elementos de nome`);
        userNames.forEach(element => {
            element.textContent = user.nome || 'Usuário';
            console.log(`✏️ Atualizado nome: "${element.textContent}"`);
        });
        
        // Atualizar email
        const userEmails = document.querySelectorAll('.user-email, #user-email, #userEmail');
        console.log(`📝 Encontrados ${userEmails.length} elementos de email`);
        userEmails.forEach(element => {
            element.textContent = user.email || '';
            console.log(`✏️ Atualizado email: "${element.textContent}"`);
        });
        
        // Atualizar role/cargo
        const userRoles = document.querySelectorAll('.user-role, #user-role, #userRole');
        console.log(`📝 Encontrados ${userRoles.length} elementos de cargo`);
        userRoles.forEach(element => {
            element.textContent = user.role || 'Funcionário';
            console.log(`✏️ Atualizado cargo: "${element.textContent}"`);
        });
        
        // Atualizar avatares
        const avatarImages = document.querySelectorAll('.user-avatar, .avatar-img, #userAvatar, .topbar-user-avatar img');
        console.log(`🖼️ Encontrados ${avatarImages.length} elementos de avatar`);
        
        const avatarUrl = obterURLAvatar(user);
        console.log(`🖼️ URL do avatar selecionada: ${avatarUrl}`);
        
        avatarImages.forEach(img => {
            const oldSrc = img.src;
            img.src = avatarUrl;
            img.onerror = function() {
                console.warn(`⚠️ Erro ao carregar avatar: ${avatarUrl}`);
                console.warn(`⚠️ Tentando fallback: /public/avatars/default.webp`);
                this.src = '/avatars/default.webp';
            };
            console.log(`🖼️ Avatar atualizado: ${oldSrc} → ${img.src}`);
        });
    }
    
    // Funçáo para obter URL do avatar com fallbacks
    function obterURLAvatar(user) {
        console.log('🎯 Obtendo URL do avatar...');
        console.log('🎯 User data:', {
            foto_perfil_url: user.foto_perfil_url,
            avatar: user.avatar,
            nome: user.nome
        });
        
        // Prioridade 1: foto_perfil_url (caminho completo)
        if (user.foto_perfil_url) {
            console.log('✅ Usando foto_perfil_url:', user.foto_perfil_url);
            return user.foto_perfil_url;
        }
        
        // Prioridade 2: avatar (pode ser caminho relativo ou nome de arquivo)
        if (user.avatar && user.avatar !== "/avatars/default.webp") {
            console.log('✅ Usando avatar:', user.avatar);
            // Se já tem caminho completo
            if (user.avatar.startsWith('/') || user.avatar.startsWith('http')) {
                return user.avatar;
            }
            // Se é só nome de arquivo, adicionar caminho
            return `/uploads/avatars/${user.avatar}`;
        }
        
        // Prioridade 3: Tentar gerar avatar baseado no nome
        if (user.nome) {
            const nomeNormalizado = user.nome.toLowerCase().replace(/\s+/g, '_');
            const avatarPath = `/uploads/avatars/${nomeNormalizado}.jpg`;
            console.log('🔄 Tentando avatar baseado no nome:', avatarPath);
            return avatarPath;
        }
        
        // Fallback final: avatar padráo
        console.log('⚠️ Usando avatar padráo');
        return '/avatars/default.webp';
    }
    
    // Expor funções globalmente
    window.UsuarioSystem = {
        carregarUsuarioLogado,
        atualizarInterfaceUsuario,
        obterURLAvatar,
        getCurrentUser: () => currentUser
    };
    
    // Carregar automaticamente quando o documento estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', carregarUsuarioLogado);
    } else {
        // Se o DOM já está pronto, carregar imediatamente
        carregarUsuarioLogado();
    }
    
    console.log('✅ Sistema de usuário inicializado');
})();
