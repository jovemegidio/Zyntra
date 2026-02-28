/**
 * User Greeting - Script compartilhado para saudação padronizada
 * Aluforce ERP System
 * 
 * Este script padroniza as saudações em todos os módulos do sistema.
 * A saudação segue o formato: "Bom dia/Boa tarde/Boa noite, {nome ou apelido}"
 * 
 * COMO USAR:
 * 1. Inclua este script na página: <script src="../../_shared/user-greeting.js"></script>
 * 2. O script detecta automaticamente elementos com classe .user-greeting ou #user-name
 * 3. Atualiza a saudação baseada na hora do dia e dados do localStorage
 */

(function() {
    'use strict';

    // Configuração
    const CONFIG = {
        // Seletores possíveis para elementos de saudação (vários padrões existentes)
        greetingSelectors: [
            '.user-greeting',
            '.user-greeting-area', 
            '.greeting-text',
            '#greeting-text',
            '#user-greeting',
            '.header-greeting'
        ],
        // Seletores para nome do usuário
        userNameSelectors: [
            '#user-name',
            '.user-name',
            '.userName',
            '#userName',
            '.greeting-name',
            '#greeting-name'
        ],
        // Seletores para avatar
        avatarSelectors: [
            '.user-avatar',
            '.user-avatar-header',
            '#user-avatar',
            '.avatar-img',
            '.header-avatar'
        ],
        // Cores para avatares gerados
        avatarColors: [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
        ]
    };

    /**
     * Obtém a saudação baseada na hora do dia
     */
    function getGreeting() {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) return 'Bom dia';
        if (hour >= 12 && hour < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    /**
     * Obtém dados do usuário do localStorage
     */
    function getUserData() {
        try {
            const stored = localStorage.getItem('userData');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.error('[UserGreeting] Erro ao ler userData:', e);
        }
        return null;
    }

    /**
     * Obtém o nome de exibição do usuário (apelido ou primeiro nome)
     */
    function getDisplayName(user) {
        if (!user) return 'Usuário';
        
        // Prioridade: apelido > primeiro nome > username > email
        if (user.apelido && user.apelido.trim()) {
            return user.apelido.trim();
        }
        
        const fullName = user.nome || user.nome_completo || user.name || '';
        if (fullName) {
            // Retorna primeiro + último nome se muito longo
            const parts = fullName.split(/\s+/).filter(Boolean);
            if (parts.length > 2) {
                return `${parts[0]} ${parts[parts.length - 1]}`;
            }
            return parts[0] || fullName;
        }
        
        if (user.username) return user.username;
        if (user.email) return user.email.split('@')[0];
        
        return 'Usuário';
    }

    /**
     * Gera iniciais para o avatar
     */
    function getInitials(name) {
        if (!name) return 'U';
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    /**
     * Gera cor consistente baseada no nome
     */
    function getAvatarColor(name) {
        if (!name) return CONFIG.avatarColors[0];
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.avatarColors[Math.abs(hash) % CONFIG.avatarColors.length];
    }

    /**
     * Configura o avatar do usuário
     */
    function setupAvatar(element, user) {
        if (!element || !user) return;

        const displayName = user.nome || user.nome_completo || user.apelido || 'Usuário';
        const email = user.email || '';
        const avatarUrl = user.avatar_url || user.foto_url || user.foto || '';

        // Se tem URL de foto, usa ela
        if (avatarUrl && avatarUrl.trim()) {
            // Verificar se já é uma tag img
            if (element.tagName === 'IMG') {
                element.src = avatarUrl;
                element.alt = displayName;
                element.onerror = function() {
                    // Fallback para iniciais se imagem falhar
                    this.style.display = 'none';
                    const fallback = createInitialsAvatar(displayName);
                    this.parentNode.appendChild(fallback);
                };
            } else {
                // Criar img dentro do container
                element.innerHTML = '';
                const img = document.createElement('img');
                img.src = avatarUrl;
                img.alt = displayName;
                img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: inherit;';
                img.onerror = function() {
                    element.innerHTML = '';
                    element.appendChild(createInitialsAvatar(displayName));
                };
                element.appendChild(img);
            }
        } else {
            // Sem foto - usar iniciais
            if (element.tagName === 'IMG') {
                element.style.display = 'none';
                const fallback = createInitialsAvatar(displayName);
                element.parentNode.appendChild(fallback);
            } else {
                element.innerHTML = '';
                element.appendChild(createInitialsAvatar(displayName));
            }
        }
    }

    /**
     * Cria elemento de avatar com iniciais
     */
    function createInitialsAvatar(name) {
        const initials = getInitials(name);
        const color = getAvatarColor(name);
        
        const span = document.createElement('span');
        span.className = 'avatar-initials';
        span.textContent = initials;
        span.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            background: ${color};
            color: white;
            font-weight: 600;
            font-size: inherit;
            border-radius: inherit;
            text-transform: uppercase;
        `;
        
        return span;
    }

    /**
     * Atualiza todos os elementos de saudação na página
     */
    function updateGreetings() {
        const user = getUserData();
        const greeting = getGreeting();
        const displayName = getDisplayName(user);
        
        console.log('[UserGreeting] Atualizando saudação:', greeting, displayName);

        // Atualizar elementos de saudação (estrutura existente com span ou strong)
        CONFIG.greetingSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                // Verificar se tem estrutura com span/strong para nome
                const nameEl = el.querySelector('strong, .user-name, #user-name');
                if (nameEl) {
                    // Tem elemento separado para nome - atualizar texto antes dele
                    const textNode = el.childNodes[0];
                    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                        textNode.textContent = `${greeting}, `;
                    } else {
                        // Inserir texto antes do nome
                        el.insertBefore(document.createTextNode(`${greeting}, `), el.firstChild);
                    }
                    nameEl.textContent = displayName;
                } else {
                    // Estrutura simples - atualizar tudo
                    el.innerHTML = `${greeting}, <strong>${displayName}</strong>`;
                }
            });
        });

        // Atualizar elementos específicos de nome
        CONFIG.userNameSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (!el.closest('.user-greeting')) { // Evitar duplicar
                    el.textContent = displayName;
                }
            });
        });

        // Atualizar label de saudação (elementos separados como no painel)
        const greetingLabel = document.getElementById('greeting-time-label');
        if (greetingLabel) {
            greetingLabel.textContent = greeting;
        }

        // Atualizar nome no greeting premium
        const greetingName = document.getElementById('greeting-name');
        if (greetingName) {
            greetingName.textContent = displayName;
        }

        // Atualizar avatares
        if (user) {
            CONFIG.avatarSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => {
                    setupAvatar(el, user);
                });
            });
        }
    }

    /**
     * Inicializa o sistema de saudação
     */
    function init() {
        // Atualizar imediatamente
        updateGreetings();
        
        // Atualizar a cada minuto (para mudar saudação quando passa da hora)
        setInterval(updateGreetings, 60000);
        
        // Expor função global para atualizações manuais
        window.updateUserGreeting = updateGreetings;
        window.getGreeting = getGreeting;
        window.getDisplayName = getDisplayName;
        
        console.log('[UserGreeting] Sistema de saudação inicializado');
    }

    // Inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-inicializar quando localStorage mudar (atualização de perfil)
    window.addEventListener('storage', function(e) {
        if (e.key === 'userData') {
            updateGreetings();
        }
    });

})();
