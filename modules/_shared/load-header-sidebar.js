/**
 * Compatibility wrapper for legacy shared layout imports.
 * The only supported shell is the global Zyntra header/sidebar.
 */
(function () {
    'use strict';

    var CSS_HREF = '/css/global-header-sidebar.css?v=20260610';
    var JS_SRC = '/js/global-sidebar-submenu.js?v=20260610b';

    function ensureCss() {
        if (document.querySelector('link[href*="global-header-sidebar.css"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS_HREF;
        document.head.appendChild(link);
    }

    function ensureShell() {
        if (!document.querySelector('.sidebar-overlay')) {
            var overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            overlay.id = 'sidebar-overlay';
            document.body.insertBefore(overlay, document.body.firstChild);
        }

        if (!document.querySelector('aside.sidebar')) {
            var sidebar = document.createElement('aside');
            sidebar.className = 'sidebar';
            sidebar.id = 'mobile-sidebar';
            document.body.insertBefore(sidebar, document.body.firstChild);
        }

        if (!document.querySelector('header.header, header#financeiro-header')) {
            var mainArea = document.querySelector('.main-area');
            if (!mainArea) {
                mainArea = document.createElement('main');
                mainArea.className = 'main-area';
                Array.prototype.slice.call(document.body.childNodes).forEach(function (child) {
                    if (child.nodeType === 1 && (
                        child.classList.contains('sidebar') ||
                        child.classList.contains('sidebar-overlay') ||
                        child.classList.contains('gs-submenu-panel') ||
                        child.tagName === 'SCRIPT'
                    )) return;
                    mainArea.appendChild(child);
                });
                document.body.appendChild(mainArea);
            }
            var header = document.createElement('header');
            header.className = 'header';
            mainArea.insertBefore(header, mainArea.firstChild);
        }
    }

    function ensureScript() {
        if (window.__gsSidebarLoaded || document.querySelector('script[src*="global-sidebar-submenu.js"]')) return;
        var script = document.createElement('script');
        script.src = JS_SRC;
        script.defer = true;
        document.body.appendChild(script);
    }

    function init() {
        ensureCss();
        ensureShell();
        ensureScript();
    }

    window.AluforceLayout = window.AluforceLayout || {
        init: init,
        refresh: init,
        addTab: function () {},
        removeTab: function () {},
        updateBadge: function () {},
        setNotificationDot: function () {},
        logout: function () { window.location.href = '/logout.html'; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();