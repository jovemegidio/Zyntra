/**
 * ALUFORCE - Mobile Responsivo
 * JavaScript para funcionalidades mobile em todos os módulos
 */

(function() {
    'use strict';

    // Detectar se é mobile
    const isMobile = () => window.innerWidth < 768;
    const isTablet = () => window.innerWidth >= 768 && window.innerWidth < 992;

    // Criar botão de menu mobile se não existir
    function createMobileMenuButton() {
        if (document.querySelector('.mobile-menu-btn')) return;
        
        const menuBtn = document.createElement('button');
        menuBtn.className = 'mobile-menu-btn';
        menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
        menuBtn.setAttribute('aria-label', 'Abrir menu');
        menuBtn.style.cssText = `
            display: none;
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: white;
            border-radius: 50%;
            border: none;
            box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
            z-index: 9997;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            cursor: pointer;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        `;
        
        menuBtn.addEventListener('click', toggleSidebar);
        document.body.appendChild(menuBtn);
        
        // Mostrar em mobile
        updateMenuButtonVisibility();
    }

    // Criar overlay para sidebar
    function createSidebarOverlay() {
        if (document.querySelector('.sidebar-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9998;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        overlay.addEventListener('click', closeSidebar);
        document.body.appendChild(overlay);
    }

    // Toggle sidebar
    function toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        const menuBtn = document.querySelector('.mobile-menu-btn');
        
        if (!sidebar) return;
        
        const isOpen = sidebar.classList.contains('open');
        
        if (isOpen) {
            closeSidebar();
        } else {
            sidebar.classList.add('open');
            sidebar.style.transform = 'translateX(0)';
            
            if (overlay) {
                overlay.style.display = 'block';
                setTimeout(() => overlay.style.opacity = '1', 10);
            }
            
            if (menuBtn) {
                menuBtn.innerHTML = '<i class="fas fa-times"></i>';
            }
            
            document.body.style.overflow = 'hidden';
        }
    }

    // Fechar sidebar
    function closeSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        const menuBtn = document.querySelector('.mobile-menu-btn');
        
        if (sidebar) {
            sidebar.classList.remove('open');
            sidebar.style.transform = '';
        }
        
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.style.display = 'none', 300);
        }
        
        if (menuBtn) {
            menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
        }
        
        document.body.style.overflow = '';
    }

    // Atualizar visibilidade do botão menu
    function updateMenuButtonVisibility() {
        const menuBtn = document.querySelector('.mobile-menu-btn');
        const sidebar = document.querySelector('.sidebar');
        
        if (!menuBtn) return;
        
        if (isMobile() && sidebar) {
            menuBtn.style.display = 'flex';
        } else {
            menuBtn.style.display = 'none';
            closeSidebar();
        }
    }

    // Adicionar atributos responsivos nas tabelas
    function makeTablesResponsive() {
        const tables = document.querySelectorAll('table:not(.table-responsive-processed)');
        
        tables.forEach(table => {
            table.classList.add('table-responsive-processed');
            
            // Obter headers
            const headers = table.querySelectorAll('th');
            const headerTexts = Array.from(headers).map(th => th.textContent.trim());
            
            // Adicionar data-label em cada célula
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                cells.forEach((cell, index) => {
                    if (headerTexts[index]) {
                        cell.setAttribute('data-label', headerTexts[index]);
                    }
                });
            });
            
            // Envolver em container se não estiver
            if (!table.closest('.table-container')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'table-container';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
        });
    }

    // Ajustar gráficos ao redimensionar
    function handleChartResize() {
        const charts = document.querySelectorAll('canvas');
        charts.forEach(canvas => {
            const chart = Chart.getChart(canvas);
            if (chart) {
                chart.resize();
            }
        });
    }

    // Otimizar scroll em touch
    function optimizeTouchScroll() {
        const scrollContainers = document.querySelectorAll('.table-container, .kanban-container, .pipeline-container');
        
        scrollContainers.forEach(container => {
            container.style.webkitOverflowScrolling = 'touch';
            container.style.overflowX = 'auto';
        });
    }

    // Fechar dropdowns ao clicar fora
    function setupDropdownClose() {
        document.addEventListener('click', function(e) {
            const dropdowns = document.querySelectorAll('.user-dropdown-menu.show, .notification-panel.active, .dropdown-menu.show');
            
            dropdowns.forEach(dropdown => {
                const trigger = dropdown.previousElementSibling || dropdown.closest('.user-profile-header, .notification-container');
                if (trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.classList.remove('show', 'active');
                }
            });
        });
    }

    // Adicionar gestos swipe para fechar sidebar
    function setupSwipeGestures() {
        let touchStartX = 0;
        let touchEndX = 0;
        const sidebar = document.querySelector('.sidebar');
        
        if (!sidebar) return;
        
        document.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        document.addEventListener('touchend', e => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
        
        function handleSwipe() {
            const swipeThreshold = 100;
            const diff = touchEndX - touchStartX;
            
            // Swipe para esquerda - fechar sidebar
            if (diff < -swipeThreshold && sidebar.classList.contains('open')) {
                closeSidebar();
            }
            
            // Swipe para direita na borda esquerda - abrir sidebar
            if (diff > swipeThreshold && touchStartX < 30 && !sidebar.classList.contains('open')) {
                toggleSidebar();
            }
        }
    }

    // Ajustar viewport para iOS
    function fixIOSViewport() {
        const viewport = document.querySelector('meta[name=viewport]');
        if (viewport) {
            viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        }
    }

    // Prevenir zoom em inputs no iOS
    function preventInputZoom() {
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (!input.style.fontSize || parseInt(input.style.fontSize) < 16) {
                // Já controlado via CSS
            }
        });
    }

    // Otimizar imagens para mobile
    function optimizeImages() {
        if (!isMobile()) return;
        
        const images = document.querySelectorAll('img:not(.optimized)');
        images.forEach(img => {
            img.classList.add('optimized');
            img.loading = 'lazy';
        });
    }

    // Debounce para resize
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

    // Inicialização
    function init() {
        // Aguardar DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    function setup() {
        createMobileMenuButton();
        createSidebarOverlay();
        makeTablesResponsive();
        optimizeTouchScroll();
        setupDropdownClose();
        setupSwipeGestures();
        fixIOSViewport();
        preventInputZoom();
        optimizeImages();
        
        // Listeners de resize
        const debouncedResize = debounce(() => {
            updateMenuButtonVisibility();
            handleChartResize();
            makeTablesResponsive();
        }, 250);
        
        window.addEventListener('resize', debouncedResize);
        window.addEventListener('orientationchange', () => {
            setTimeout(debouncedResize, 100);
        });
        
        // Observer para novos elementos
        const observer = new MutationObserver(debounce(() => {
            makeTablesResponsive();
            optimizeImages();
        }, 500));
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('📱 ALUFORCE Mobile Responsive initialized');
    }

    // Exportar funções úteis
    window.AluforceResponsive = {
        toggleSidebar,
        closeSidebar,
        isMobile,
        isTablet,
        makeTablesResponsive
    };

    init();
})();
