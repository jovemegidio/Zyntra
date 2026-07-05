/**
 * ALUFORCE - Mobile Menu Handler v2.1
 * Sistema de menu responsivo para dispositivos móveis
 * Inclui saudação do usuário no sidebar
 */

(function() {
    'use strict';

    // Configurações
    const CONFIG = {
        sidebarSelector: '.sidebar',
        overlayId: 'mobile-overlay',
        menuBtnClass: 'mobile-menu-btn',
        breakpoint: 768,
        animationDuration: 300
    };

    // Estado
    let isOpen = false;
    let sidebar = null;
    let overlay = null;
    let menuBtn = null;
    let userInfoAdded = false;

    /**
     * Obtém dados do usuário do localStorage
     */
    function getUserData() {
        try {
            const userData = localStorage.getItem('userData') || localStorage.getItem('user');
            if (userData) {
                return JSON.parse(userData);
            }
        } catch (e) {
            console.warn('Erro ao obter dados do usuário:', e);
        }
        return null;
    }

    /**
     * Obtém saudação baseada na hora
     */
    function getGreeting() {
        const hora = new Date().getHours();
        if (hora >= 5 && hora < 12) return 'Bom dia';
        if (hora >= 12 && hora < 18) return 'Boa tarde';
        if (hora >= 18 && hora < 24) return 'Boa noite';
        return 'Olá';
    }

    /**
     * Adiciona informações do usuário no header (versão mobile)
     */
    function addUserInfoToHeader() {
        // Só adiciona em mobile
        if (window.innerWidth >= CONFIG.breakpoint) return;
        
        const user = getUserData();
        if (!user) return;

        // Encontrar o header
        const header = document.querySelector('.header, .main-header, .topbar');
        if (!header) return;

        // Verifica se já existe
        if (header.querySelector('.header-user-info-mobile')) return;

        const displayName = user.apelido || user.nome || user.name || 'Usuário';
        const firstName = displayName.split(' ')[0];
        const avatar = user.avatar || user.foto || user.foto_perfil_url || '/avatars/default.webp';
        const greeting = getGreeting();

        const userInfoHTML = `
            <div class="header-user-info-mobile">
                <img src="${avatar}" alt="${displayName}" class="header-user-avatar-mobile" onerror="this.src='/avatars/default.webp'">
                <div class="header-user-greeting-mobile">
                    <span class="header-user-greeting-text">${greeting},</span>
                    <span class="header-user-name-text">${firstName}</span>
                </div>
            </div>
        `;

        // Inserir após o botão de menu
        const menuBtn = header.querySelector('.mobile-menu-btn');
        if (menuBtn) {
            menuBtn.insertAdjacentHTML('afterend', userInfoHTML);
        } else {
            const headerLeft = header.querySelector('.header-left');
            if (headerLeft) {
                headerLeft.insertAdjacentHTML('beforeend', userInfoHTML);
            }
        }

        console.log('👤 Saudação do usuário adicionada ao header mobile');
    }

    /**
     * Adiciona informações do usuário no sidebar
     */
    function addUserInfoToSidebar() {
        if (userInfoAdded || !sidebar) return;

        const user = getUserData();
        if (!user) return;

        // Verifica se já existe
        if (sidebar.querySelector('.sidebar-user-info')) return;

        const displayName = user.apelido || user.nome || user.name || 'Usuário';
        const avatar = user.avatar || user.foto || user.foto_perfil_url || '/avatars/default.webp';
        const email = user.email || '';
        const greeting = getGreeting();

        const userInfoHTML = `
            <div class="sidebar-user-info">
                <img src="${avatar}" alt="${displayName}" class="sidebar-user-avatar" onerror="this.src='/avatars/default.webp'">
                <div class="sidebar-user-greeting">${greeting},</div>
                <div class="sidebar-user-name">${displayName}</div>
                <div class="sidebar-user-email">${email}</div>
            </div>
        `;

        // Inserir após o logo
        const logo = sidebar.querySelector('.sidebar-logo');
        if (logo) {
            logo.insertAdjacentHTML('afterend', userInfoHTML);
        } else {
            sidebar.insertAdjacentHTML('afterbegin', userInfoHTML);
        }

        userInfoAdded = true;
    }

    /**
     * Inicializa o sistema de menu mobile
     */
    function init() {
        // Só inicializa em telas pequenas
        if (window.innerWidth >= CONFIG.breakpoint) {
            return;
        }

        sidebar = document.querySelector(CONFIG.sidebarSelector);
        if (!sidebar) return;

        createOverlay();
        createMenuButton();
        addUserInfoToHeader(); // Adicionar saudação no header mobile
        setupEventListeners();
        addUserInfoToSidebar();
        
        console.log('📱 Menu mobile inicializado com saudação');
    }

    /**
     * Cria o overlay de fundo
     */
    function createOverlay() {
        if (document.getElementById(CONFIG.overlayId)) return;
        
        overlay = document.createElement('div');
        overlay.id = CONFIG.overlayId;
        overlay.className = 'mobile-overlay';
        overlay.addEventListener('click', close);
        document.body.appendChild(overlay);
    }

    /**
     * Cria o botão do menu
     */
    function createMenuButton() {
        // Verifica se já existe um botão no HTML
        const existingBtn = document.querySelector('.' + CONFIG.menuBtnClass);
        if (existingBtn) {
            // Usar o botão existente e adicionar o event listener
            menuBtn = existingBtn;
            menuBtn.addEventListener('click', toggle);
            return;
        }

        // Encontrar o header
        const header = document.querySelector('.header, .main-header, .topbar');
        if (!header) return;

        const headerLeft = header.querySelector('.header-left') || header;
        
        menuBtn = document.createElement('button');
        menuBtn.className = CONFIG.menuBtnClass;
        menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
        menuBtn.setAttribute('aria-label', 'Menu');
        menuBtn.setAttribute('title', 'Menu');
        menuBtn.addEventListener('click', toggle);

        // Inserir no início do header-left
        headerLeft.insertBefore(menuBtn, headerLeft.firstChild);
    }

    /**
     * Abre o menu
     */
    function open() {
        if (!sidebar || isOpen) return;
        
        isOpen = true;
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        if (menuBtn) {
            menuBtn.innerHTML = '<i class="fas fa-times"></i>';
        }

        // Focar no primeiro item do menu para acessibilidade
        const firstItem = sidebar.querySelector('.sidebar-btn, .sidebar-nav a');
        if (firstItem) {
            setTimeout(() => firstItem.focus(), CONFIG.animationDuration);
        }
    }

    /**
     * Fecha o menu
     */
    function close() {
        if (!sidebar || !isOpen) return;
        
        isOpen = false;
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        
        if (menuBtn) {
            menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
        }
    }

    /**
     * Toggle do menu
     */
    function toggle() {
        if (isOpen) {
            close();
        } else {
            open();
        }
    }

    /**
     * Configura event listeners
     */
    function setupEventListeners() {
        // Fechar ao clicar em um link do menu
        sidebar.querySelectorAll('a, button').forEach(item => {
            item.addEventListener('click', (e) => {
                // Não fecha se for um botão que abre submenu
                if (e.target.closest('[data-toggle]')) return;
                
                // Pequeno delay para permitir a navegação
                setTimeout(close, 100);
            });
        });

        // Fechar com tecla Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) {
                close();
                if (menuBtn) menuBtn.focus();
            }
        });

        // Redimensionamento da janela
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window.innerWidth >= CONFIG.breakpoint) {
                    close();
                    // Remover elementos móveis em desktop
                    sidebar.classList.remove('open');
                    if (overlay) overlay.classList.remove('active');
                }
            }, 100);
        });

        // Gestos de swipe
        setupSwipeGestures();
    }

    /**
     * Configura gestos de swipe
     */
    function setupSwipeGestures() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;
        const minSwipeDistance = 50;

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].clientX;
            touchEndY = e.changedTouches[0].clientY;
            handleSwipe();
        }, { passive: true });

        function handleSwipe() {
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;

            // Só considera swipe horizontal se for maior que vertical
            if (Math.abs(diffX) < Math.abs(diffY)) return;
            if (Math.abs(diffX) < minSwipeDistance) return;

            if (diffX > 0 && touchStartX < 30) {
                // Swipe da esquerda para direita (abre menu)
                open();
            } else if (diffX < 0 && isOpen) {
                // Swipe da direita para esquerda (fecha menu)
                close();
            }
        }
    }

    // Inicializar quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-inicializar após navegação SPA
    window.addEventListener('popstate', init);

    // Expor API global
    window.MobileMenu = {
        open: open,
        close: close,
        toggle: toggle,
        isOpen: () => isOpen
    };

})();
