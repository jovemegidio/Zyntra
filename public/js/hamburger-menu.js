/**
 * ALUFORCE - Menu Hambúrguer e Responsividade v3.0
 * Controla menu mobile/tablet, overlay e interações
 * © 2026 ALUFORCE
 */

(function() {
    'use strict';

    // Configurações
    const CONFIG = {
        breakpoints: {
            mobile: 767,
            tablet: 1024,
            desktop: 1366
        },
        selectors: {
            hamburger: '.hamburger-menu, .mobile-menu-btn, #hamburger-btn, [data-toggle="sidebar"]',
            sidebar: '.sidebar, .drawer-menu, #sidebar, #drawer-menu',
            overlay: '.sidebar-overlay, .mobile-overlay, #sidebar-overlay',
            closeBtn: '.drawer-close, .sidebar-close, [data-close="sidebar"]',
            navItems: '.sidebar-btn, .nav-item, .menu-item, .drawer-item'
        },
        classes: {
            open: 'open',
            active: 'active',
            bodyNoScroll: 'sidebar-open'
        }
    };

    // Estado
    let state = {
        isOpen: false,
        isMobile: false,
        isTablet: false
    };

    // Elementos DOM
    let elements = {
        hamburger: null,
        sidebar: null,
        overlay: null,
        closeBtn: null
    };

    /**
     * Inicializa o sistema de menu responsivo
     */
    function init() {
        // Esperar DOM carregar
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    /**
     * Configura elementos e eventos
     */
    function setup() {
        findElements();
        createMissingElements();
        bindEvents();
        checkBreakpoint();
        
        // Log para debug
        console.log('[ALUFORCE] Menu responsivo inicializado');
    }

    /**
     * Encontra elementos no DOM
     */
    function findElements() {
        elements.hamburger = document.querySelector(CONFIG.selectors.hamburger);
        elements.sidebar = document.querySelector(CONFIG.selectors.sidebar);
        elements.overlay = document.querySelector(CONFIG.selectors.overlay);
        elements.closeBtn = document.querySelector(CONFIG.selectors.closeBtn);
    }

    /**
     * Cria elementos que não existem
     */
    function createMissingElements() {
        // Criar botão hambúrguer se não existir
        if (!elements.hamburger && elements.sidebar) {
            elements.hamburger = createHamburgerButton();
        }

        // Criar overlay se não existir
        if (!elements.overlay) {
            elements.overlay = createOverlay();
        }
    }

    /**
     * Cria o botão hambúrguer
     */
    function createHamburgerButton() {
        const btn = document.createElement('button');
        btn.className = 'hamburger-menu';
        btn.id = 'hamburger-btn';
        btn.setAttribute('aria-label', 'Abrir menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = `
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
        `;

        // Inserir no header
        const header = document.querySelector('.header-left, .topbar-left, .header .container');
        if (header) {
            header.insertBefore(btn, header.firstChild);
        } else {
            // Criar container no body se necessário
            const headerEl = document.querySelector('.header, .topbar, .main-header');
            if (headerEl) {
                const leftContainer = document.createElement('div');
                leftContainer.className = 'header-left';
                leftContainer.appendChild(btn);
                headerEl.insertBefore(leftContainer, headerEl.firstChild);
            }
        }

        return btn;
    }

    /**
     * Cria o overlay
     */
    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebar-overlay';
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Vincula eventos
     */
    function bindEvents() {
        // Click no hambúrguer
        if (elements.hamburger) {
            elements.hamburger.addEventListener('click', toggleSidebar);
        }

        // Click no overlay
        if (elements.overlay) {
            elements.overlay.addEventListener('click', closeSidebar);
        }

        // Click no botão fechar
        if (elements.closeBtn) {
            elements.closeBtn.addEventListener('click', closeSidebar);
        }

        // Resize da janela
        window.addEventListener('resize', debounce(handleResize, 150));

        // Tecla ESC
        document.addEventListener('keydown', handleKeydown);

        // Swipe para fechar (touch)
        if (elements.sidebar) {
            setupSwipeGesture(elements.sidebar);
        }

        // Links da navegação fecham o menu em mobile
        document.querySelectorAll(CONFIG.selectors.navItems).forEach(item => {
            item.addEventListener('click', () => {
                if (state.isMobile || state.isTablet) {
                    setTimeout(closeSidebar, 150);
                }
            });
        });
    }

    /**
     * Toggle da sidebar
     */
    function toggleSidebar() {
        if (state.isOpen) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }

    /**
     * Abre a sidebar
     */
    function openSidebar() {
        state.isOpen = true;

        if (elements.sidebar) {
            elements.sidebar.classList.add(CONFIG.classes.open);
        }

        if (elements.overlay) {
            elements.overlay.classList.add(CONFIG.classes.active);
        }

        if (elements.hamburger) {
            elements.hamburger.classList.add(CONFIG.classes.active);
            elements.hamburger.setAttribute('aria-expanded', 'true');
        }

        document.body.classList.add(CONFIG.classes.bodyNoScroll);

        // Dispatch evento customizado
        document.dispatchEvent(new CustomEvent('sidebar:open'));
    }

    /**
     * Fecha a sidebar
     */
    function closeSidebar() {
        state.isOpen = false;

        if (elements.sidebar) {
            elements.sidebar.classList.remove(CONFIG.classes.open);
        }

        if (elements.overlay) {
            elements.overlay.classList.remove(CONFIG.classes.active);
        }

        if (elements.hamburger) {
            elements.hamburger.classList.remove(CONFIG.classes.active);
            elements.hamburger.setAttribute('aria-expanded', 'false');
        }

        document.body.classList.remove(CONFIG.classes.bodyNoScroll);

        // Dispatch evento customizado
        document.dispatchEvent(new CustomEvent('sidebar:close'));
    }

    /**
     * Verifica breakpoint atual
     */
    function checkBreakpoint() {
        const width = window.innerWidth;
        
        state.isMobile = width <= CONFIG.breakpoints.mobile;
        state.isTablet = width > CONFIG.breakpoints.mobile && width <= CONFIG.breakpoints.tablet;

        // Fechar sidebar em desktop
        if (width > CONFIG.breakpoints.tablet && state.isOpen) {
            closeSidebar();
        }
    }

    /**
     * Handler de resize
     */
    function handleResize() {
        checkBreakpoint();
    }

    /**
     * Handler de teclas
     */
    function handleKeydown(e) {
        if (e.key === 'Escape' && state.isOpen) {
            closeSidebar();
        }
    }

    /**
     * Configura gesto de swipe
     */
    function setupSwipeGesture(element) {
        let touchStartX = 0;
        let touchEndX = 0;
        const minSwipeDistance = 50;

        element.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        element.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });

        function handleSwipe() {
            const swipeDistance = touchEndX - touchStartX;
            
            // Swipe para esquerda fecha o menu
            if (swipeDistance < -minSwipeDistance && state.isOpen) {
                closeSidebar();
            }
        }
    }

    /**
     * Debounce helper
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // API pública
    window.AluforceMenu = {
        open: openSidebar,
        close: closeSidebar,
        toggle: toggleSidebar,
        isOpen: () => state.isOpen,
        isMobile: () => state.isMobile,
        isTablet: () => state.isTablet
    };

    // Inicializar
    init();

})();

// CSS inline para garantir funcionamento básico
(function() {
    const style = document.createElement('style');
    style.textContent = `
        /* Body quando sidebar está aberta */
        body.sidebar-open {
            overflow: hidden !important;
            position: fixed;
            width: 100%;
        }
        
        /* Hamburger menu base */
        .hamburger-menu {
            display: none;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            width: 44px;
            height: 44px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 10px;
            cursor: pointer;
            z-index: 1001;
            transition: all 0.3s ease;
        }
        
        .hamburger-line {
            width: 22px;
            height: 2px;
            background: #ffffff;
            border-radius: 2px;
            transition: all 0.3s ease;
            transform-origin: center;
        }
        
        .hamburger-line:nth-child(1) { margin-bottom: 5px; }
        .hamburger-line:nth-child(3) { margin-top: 5px; }
        
        .hamburger-menu.active .hamburger-line:nth-child(1) {
            transform: translateY(7px) rotate(45deg);
        }
        .hamburger-menu.active .hamburger-line:nth-child(2) {
            opacity: 0;
            transform: scaleX(0);
        }
        .hamburger-menu.active .hamburger-line:nth-child(3) {
            transform: translateY(-7px) rotate(-45deg);
        }
        
        @media (max-width: 1024px) {
            .hamburger-menu {
                display: flex !important;
            }
        }
        
        /* Overlay */
        .sidebar-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
            z-index: 998;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .sidebar-overlay.active {
            display: block;
            opacity: 1;
        }
        
        /* Sidebar mobile/tablet */
        @media (max-width: 1024px) {
            .sidebar {
                position: fixed !important;
                left: 0;
                top: 0;
                width: 280px !important;
                height: 100vh !important;
                transform: translateX(-100%);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                z-index: 999 !important;
            }
            
            .sidebar.open {
                transform: translateX(0);
                box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
            }
            
            .main-content,
            .main-area,
            .content-area {
                margin-left: 0 !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
