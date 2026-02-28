/**
 * Avatar Loader - Sistema de carregamento otimizado de avatares
 * Evita múltiplas tentativas e 404s desnecessários
 */
(function() {
    'use strict';

    const AVATAR_BASE_PATH = '/avatars/';
    const DEFAULT_AVATAR = AVATAR_BASE_PATH + 'default.webp';
    
    // Cache de avatares que já falharam
    const failedAvatars = new Set();
    
    // Cache de avatares que existem
    const existingAvatars = new Set();

    /**
     * Carrega um avatar com fallback para o padrão
     * @param {HTMLImageElement} img - Elemento img
     * @param {string} avatarName - Nome do avatar (ex: "joao.webp" ou "joao")
     */
    window.loadAvatar = function(img, avatarName) {
        if (!img || !avatarName) {
            if (img) img.src = DEFAULT_AVATAR;
            return;
        }

        // Normalizar nome do avatar
        let normalizedName = avatarName.trim();
        
        // Se não tem extensão, adicionar .webp
        if (!normalizedName.match(/\.(webp|png|jpg|jpeg|svg)$/i)) {
            normalizedName += '.webp';
        }

        const avatarPath = AVATAR_BASE_PATH + normalizedName;

        // Se já sabemos que falhou, usar default imediatamente
        if (failedAvatars.has(normalizedName)) {
            img.src = DEFAULT_AVATAR;
            return;
        }

        // Se já sabemos que existe, usar diretamente
        if (existingAvatars.has(normalizedName)) {
            img.src = avatarPath;
            return;
        }

        // Configurar handlers antes de definir src
        img.onerror = function() {
            // Marcar como falho
            failedAvatars.add(normalizedName);
            
            // Evitar loop infinito
            this.onerror = null;
            
            // Usar avatar padrão
            this.src = DEFAULT_AVATAR;
        };

        img.onload = function() {
            // Marcar como existente
            existingAvatars.add(normalizedName);
            this.onload = null;
        };

        // Definir src
        img.src = avatarPath;
    };

    /**
     * Inicializa avatares em elementos específicos
     * @param {string} selector - Seletor CSS dos elementos
     */
    window.initAvatars = function(selector = '.user-avatar, [data-avatar]') {
        const images = document.querySelectorAll(selector);
        
        images.forEach(img => {
            // Pegar nome do avatar de data-avatar ou src atual
            let avatarName = img.dataset.avatar || 
                           img.getAttribute('data-username') ||
                           img.src.split('/').pop();
            
            if (avatarName && avatarName !== 'default.webp') {
                loadAvatar(img, avatarName);
            } else {
                img.src = DEFAULT_AVATAR;
            }
        });
    };

    /**
     * Pré-carrega avatares comuns
     */
    window.preloadCommonAvatars = function(avatarNames = []) {
        avatarNames.forEach(name => {
            const img = new Image();
            img.onload = () => existingAvatars.add(name);
            img.onerror = () => failedAvatars.add(name);
            img.src = AVATAR_BASE_PATH + (name.match(/\.(webp|png|jpg|jpeg|svg)$/i) ? name : name + '.webp');
        });
    };

    // Auto-inicialização quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.initAvatars();
        });
    } else {
        window.initAvatars();
    }

    console.log('✅ Avatar Loader inicializado');
})();
