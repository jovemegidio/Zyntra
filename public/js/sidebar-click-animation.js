/**
 * Global Sidebar Click Animation
 * Adds smooth active state transition and pulse animation
 * when clicking sidebar navigation buttons across all modules.
 * 
 * v1.2 — 2026-02-25 — Fixed navigation lock never releasing (caused frozen sidebar)
 */
(function() {
    'use strict';

    // Delay before navigation (ms) — allows animation to play
    const NAV_DELAY = 150;

    // Navigation lock — prevents double-click from firing multiple navigations
    let isNavigating = false;

    document.addEventListener('DOMContentLoaded', function() {
        // Intercept all sidebar button clicks
        const sidebar = document.querySelector('.sidebar, #mobile-sidebar');
        if (!sidebar) return;

        sidebar.addEventListener('click', function(e) {
            // Block if already navigating
            if (isNavigating) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Find the clicked button/link
            const btn = e.target.closest('.sidebar-btn, .sidebar-nav a, .sidebar-nav button, .sidebar-bottom a, .sidebar-bottom button');
            if (!btn) return;

            // Skip config/toggle buttons (they open panels, not navigate)
            if (btn.id === 'btn-config' || btn.id === 'btn-dark-mode') return;
            // Skip if it calls toggleConfiguracoes or similar panel functions
            const onclickAttr = btn.getAttribute('onclick') || '';
            if (onclickAttr.includes('toggleConfiguracoes') || 
                onclickAttr.includes('abrirModal') ||
                (onclickAttr.includes('toggleMobileSidebar') && !onclickAttr.includes('location') && !onclickAttr.includes('showView'))) return;

            // Skip if already active
            if (btn.classList.contains('active')) return;

            // Determine destination URL
            let targetUrl = null;

            if (btn.tagName === 'A' && btn.href) {
                targetUrl = btn.getAttribute('href');
            } else if (onclickAttr) {
                // Extract URL from window.location.href='...' or location.href='...'
                const hrefMatch = onclickAttr.match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/);
                if (hrefMatch) {
                    targetUrl = hrefMatch[1];
                }
                // Check for showView('view-xxx') or navigateSection() pattern — let them handle own animation
                if (onclickAttr.includes('showView') || onclickAttr.includes('navigateSection')) return;
            }

            // If we found a target URL, intercept and animate
            if (targetUrl) {
                e.preventDefault();
                e.stopImmediatePropagation();

                // Lock navigation
                isNavigating = true;

                // Remove active from all buttons
                sidebar.querySelectorAll('.sidebar-btn.active, .sidebar-nav a.active, .sidebar-nav button.active, .sidebar-bottom a.active, .sidebar-bottom button.active').forEach(function(b) {
                    b.classList.remove('active');
                });

                // Add active + pulse to clicked button
                btn.classList.add('active', 'click-pulse');

                // Disable pointer events on sidebar to prevent any more clicks
                sidebar.style.pointerEvents = 'none';

                // Navigate after brief animation
                setTimeout(function() {
                    window.location.href = targetUrl;
                }, NAV_DELAY);

                // Safety: release lock after 3s in case navigation didn't happen
                setTimeout(function() {
                    isNavigating = false;
                    sidebar.style.pointerEvents = '';
                }, 3000);
            }
        }, true); // Use capture to intercept before onclick handlers
    });

    // Auto-load user-dropdown.js if not already present
    if (!document.querySelector('script[src*="user-dropdown"]')) {
        var s = document.createElement('script');
        s.src = '/js/user-dropdown.js?v=20260226';
        s.defer = true;
        document.body.appendChild(s);
    }
})();
