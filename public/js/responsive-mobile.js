/**
 * ALUFORCE - Sistema de Responsividade Mobile
 * Controle de menu, sidebar e interações mobile
 * Versão: 2.0 - Janeiro 2026
 */

(function() {
    'use strict';
    
    // Configuração
    const CONFIG = {
        breakpoints: {
            mobile: 767,
            tablet: 1023
        },
        selectors: {
            sidebar: '.sidebar, .side-nav, .nav-sidebar, .main-sidebar',
            header: 'header, .header, .main-header',
            mainArea: '.main-area, .main-content, .content-wrapper',
            menuToggle: '.menu-toggle, .hamburger, .mobile-menu-btn',
            overlay: '.sidebar-overlay, .nav-overlay',
            dropdowns: '.dropdown-menu, .dropdown-content',
            modals: '.modal, .popup, .dialog'
        },
        classes: {
            open: 'open',
            active: 'active',
            show: 'show'
        }
    };
    
    // Estado
    const state = {
        sidebarOpen: false,
        currentBreakpoint: null,
        touchStartX: 0,
        touchStartY: 0
    };
    
    /**
     * Detectar breakpoint atual
     */
    function detectBreakpoint() {
        const width = window.innerWidth;
        if (width <= CONFIG.breakpoints.mobile) return 'mobile';
        if (width <= CONFIG.breakpoints.tablet) return 'tablet';
        return 'desktop';
    }
    
    /**
     * Criar overlay da sidebar se não existir
     */
    function createSidebarOverlay() {
        if (document.querySelector('.sidebar-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.addEventListener('click', closeSidebar);
        document.body.appendChild(overlay);
        
        return overlay;
    }
    
    /**
     * Criar botão de menu toggle se não existir
     */
    function createMenuToggle() {
        if (document.querySelector('.menu-toggle')) return;
        
        const header = document.querySelector(CONFIG.selectors.header);
        if (!header) return;
        
        const toggle = document.createElement('button');
        toggle.className = 'menu-toggle mobile-only';
        toggle.setAttribute('aria-label', 'Abrir menu');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
        `;
        toggle.addEventListener('click', toggleSidebar);
        
        // Inserir no início do header
        const headerContent = header.querySelector('.header-content, .header-inner') || header;
        headerContent.insertBefore(toggle, headerContent.firstChild);
        
        return toggle;
    }
    
    /**
     * Abrir sidebar
     */
    function openSidebar() {
        const sidebar = document.querySelector(CONFIG.selectors.sidebar);
        const overlay = document.querySelector('.sidebar-overlay');
        const toggle = document.querySelector('.menu-toggle');
        
        if (sidebar) {
            sidebar.classList.add(CONFIG.classes.open, CONFIG.classes.active);
        }
        
        if (overlay) {
            overlay.classList.add(CONFIG.classes.active);
        }
        
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'true');
        }
        
        // Prevenir scroll do body
        document.body.style.overflow = 'hidden';
        state.sidebarOpen = true;
    }
    
    /**
     * Fechar sidebar
     */
    function closeSidebar() {
        const sidebar = document.querySelector(CONFIG.selectors.sidebar);
        const overlay = document.querySelector('.sidebar-overlay');
        const toggle = document.querySelector('.menu-toggle');
        
        if (sidebar) {
            sidebar.classList.remove(CONFIG.classes.open, CONFIG.classes.active);
        }
        
        if (overlay) {
            overlay.classList.remove(CONFIG.classes.active);
        }
        
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
        }
        
        // Restaurar scroll do body
        document.body.style.overflow = '';
        state.sidebarOpen = false;
    }
    
    /**
     * Toggle sidebar
     */
    function toggleSidebar() {
        if (state.sidebarOpen) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }
    
    /**
     * Configurar gestos de swipe
     */
    function setupSwipeGestures() {
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    
    function handleTouchStart(e) {
        state.touchStartX = e.touches[0].clientX;
        state.touchStartY = e.touches[0].clientY;
    }
    
    function handleTouchMove(e) {
        if (!state.touchStartX) return;
        
        const xDiff = state.touchStartX - e.touches[0].clientX;
        const yDiff = state.touchStartY - e.touches[0].clientY;
        
        // Se swipe horizontal for maior que vertical
        if (Math.abs(xDiff) > Math.abs(yDiff)) {
            // Se estiver na borda esquerda e swipe para direita
            if (state.touchStartX < 30 && xDiff < -50 && !state.sidebarOpen) {
                openSidebar();
            }
            // Se sidebar aberta e swipe para esquerda
            else if (xDiff > 50 && state.sidebarOpen) {
                closeSidebar();
            }
        }
    }
    
    function handleTouchEnd() {
        state.touchStartX = 0;
        state.touchStartY = 0;
    }
    
    /**
     * Configurar dropdowns para mobile
     */
    function setupMobileDropdowns() {
        document.querySelectorAll('.dropdown-toggle, [data-toggle="dropdown"]').forEach(toggle => {
            toggle.addEventListener('click', function(e) {
                if (detectBreakpoint() !== 'mobile') return;
                
                e.preventDefault();
                e.stopPropagation();
                
                const dropdown = this.nextElementSibling || 
                                 this.parentElement.querySelector('.dropdown-menu');
                
                if (dropdown) {
                    // Fechar outros dropdowns
                    document.querySelectorAll(CONFIG.selectors.dropdowns).forEach(d => {
                        if (d !== dropdown) {
                            d.classList.remove(CONFIG.classes.show);
                        }
                    });
                    
                    dropdown.classList.toggle(CONFIG.classes.show);
                    
                    // Criar overlay para fechar
                    if (dropdown.classList.contains(CONFIG.classes.show)) {
                        createDropdownOverlay(dropdown);
                    }
                }
            });
        });
    }
    
    function createDropdownOverlay(dropdown) {
        const existing = document.querySelector('.dropdown-overlay');
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.className = 'dropdown-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(0,0,0,0.3);
        `;
        overlay.addEventListener('click', () => {
            dropdown.classList.remove(CONFIG.classes.show);
            overlay.remove();
        });
        document.body.appendChild(overlay);
    }
    
    /**
     * Configurar modais para mobile
     */
    function setupMobileModals() {
        // Observer para novos modais
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.matches && node.matches(CONFIG.selectors.modals)) {
                        adaptModalForMobile(node);
                    }
                });
            });
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Adaptar modais existentes
        document.querySelectorAll(CONFIG.selectors.modals).forEach(adaptModalForMobile);
    }
    
    function adaptModalForMobile(modal) {
        if (detectBreakpoint() !== 'mobile') return;
        
        // Adicionar gesture para fechar
        const content = modal.querySelector('.modal-content, .popup-content');
        if (content) {
            let startY = 0;
            let currentY = 0;
            
            content.addEventListener('touchstart', e => {
                if (e.target.closest('.modal-header')) {
                    startY = e.touches[0].clientY;
                }
            }, { passive: true });
            
            content.addEventListener('touchmove', e => {
                if (startY) {
                    currentY = e.touches[0].clientY - startY;
                    if (currentY > 0) {
                        content.style.transform = `translateY(${currentY}px)`;
                    }
                }
            }, { passive: true });
            
            content.addEventListener('touchend', () => {
                if (currentY > 100) {
                    // Fechar modal
                    const closeBtn = modal.querySelector('.modal-close, .close-btn, [data-dismiss="modal"]');
                    if (closeBtn) closeBtn.click();
                } else {
                    content.style.transform = '';
                }
                startY = 0;
                currentY = 0;
            }, { passive: true });
        }
    }
    
    /**
     * Configurar tabelas responsivas
     */
    function setupResponsiveTables() {
        document.querySelectorAll('table').forEach(table => {
            // Adicionar wrapper se não tiver
            if (!table.closest('.table-container, .table-wrapper')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'table-container';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
            
            // Adicionar data-labels para mobile cards
            const headers = table.querySelectorAll('thead th');
            const rows = table.querySelectorAll('tbody tr');
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                cells.forEach((cell, index) => {
                    if (headers[index]) {
                        cell.setAttribute('data-label', headers[index].textContent.trim());
                    }
                });
            });
        });
    }
    
    /**
     * Configurar inputs para evitar zoom no iOS
     */
    function setupIOSInputs() {
        // Adicionar viewport meta se não existir
        let viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.appendChild(viewport);
        }
        viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    }
    
    /**
     * Listener de resize
     */
    function handleResize() {
        const newBreakpoint = detectBreakpoint();
        
        if (newBreakpoint !== state.currentBreakpoint) {
            state.currentBreakpoint = newBreakpoint;
            
            // Fechar sidebar ao mudar para desktop
            if (newBreakpoint === 'desktop') {
                closeSidebar();
            }
            
            // Disparar evento customizado
            document.dispatchEvent(new CustomEvent('breakpointChange', {
                detail: { breakpoint: newBreakpoint }
            }));
        }
    }
    
    /**
     * Fechar sidebar ao clicar em link
     */
    function setupSidebarLinks() {
        document.querySelectorAll('.sidebar a, .side-nav a').forEach(link => {
            link.addEventListener('click', () => {
                if (detectBreakpoint() === 'mobile') {
                    setTimeout(closeSidebar, 100);
                }
            });
        });
    }
    
    /**
     * Configurar scroll para inputs em mobile
     */
    function setupMobileInputScroll() {
        document.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('focus', () => {
                if (detectBreakpoint() === 'mobile') {
                    setTimeout(() => {
                        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                }
            });
        });
    }
    
    /**
     * API Pública
     */
    window.AluforceResponsive = {
        openSidebar,
        closeSidebar,
        toggleSidebar,
        getBreakpoint: detectBreakpoint,
        isMobile: () => detectBreakpoint() === 'mobile',
        isTablet: () => detectBreakpoint() === 'tablet',
        isDesktop: () => detectBreakpoint() === 'desktop'
    };
    
    /**
     * Inicialização
     */
    function init() {
        state.currentBreakpoint = detectBreakpoint();
        
        // Criar elementos necessários
        createSidebarOverlay();
        createMenuToggle();
        
        // Configurar funcionalidades
        setupSwipeGestures();
        setupMobileDropdowns();
        setupMobileModals();
        setupResponsiveTables();
        setupIOSInputs();
        setupSidebarLinks();
        setupMobileInputScroll();
        
        // Listeners
        window.addEventListener('resize', debounce(handleResize, 150));
        
        // Fechar sidebar com ESC
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && state.sidebarOpen) {
                closeSidebar();
            }
        });
        
        // Adicionar classe ao body baseada no breakpoint
        document.body.classList.add(`is-${state.currentBreakpoint}`);
        
        console.log('✅ ALUFORCE Responsive inicializado');
    }
    
    // Debounce helper
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
    
    // Iniciar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();

// CSS adicional inline para elementos criados dinamicamente
(function() {
    const style = document.createElement('style');
    style.textContent = `
        /* Menu Toggle Button */
        .menu-toggle {
            display: none;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            padding: 8px;
            background: transparent;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            color: inherit;
            transition: background 0.2s;
        }
        
        .menu-toggle:hover {
            background: rgba(0, 0, 0, 0.05);
        }
        
        .menu-toggle svg {
            width: 24px;
            height: 24px;
        }
        
        /* Sidebar Overlay */
        .sidebar-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9998;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
            backdrop-filter: blur(2px);
        }
        
        .sidebar-overlay.active {
            opacity: 1;
            visibility: visible;
        }
        
        /* Mobile Only */
        @media (max-width: 767px) {
            .menu-toggle {
                display: flex !important;
            }
            
            .mobile-only {
                display: block !important;
            }
            
            .desktop-only {
                display: none !important;
            }
        }
        
        @media (min-width: 768px) {
            .mobile-only {
                display: none !important;
            }
        }
        
        /* Body state classes */
        body.is-mobile {
            --current-breakpoint: mobile;
        }
        
        body.is-tablet {
            --current-breakpoint: tablet;
        }
        
        body.is-desktop {
            --current-breakpoint: desktop;
        }
        
        /* Touch friendly */
        @media (hover: none) and (pointer: coarse) {
            button, a, .clickable {
                min-height: 44px;
                min-width: 44px;
            }
        }
    `;
    document.head.appendChild(style);
})();
