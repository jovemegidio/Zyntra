/**
 * ALUFORCE - Tooltips Profissionais (Ativador)
 * Converte atributos title → data-title para ativar os tooltips CSS profissionais
 * e suprimir os tooltips nativos do navegador.
 * 
 * Inclua APÓS o CSS: <link rel="stylesheet" href="/css/tooltips-professional.css?v=20260209">
 * Inclua este JS:    <script src="/js/tooltips-professional.js?v=20260209"><\/script>
 */
(function() {
    'use strict';

    function ativarTooltips() {
        /* Seletores que devem ter tooltip profissional */
        var seletores = [
            '.sidebar-btn[title]',
            '.header-btn[title]',
            '.btn-icon[title]',
            '.module-card[title]'
        ];

        var els = document.querySelectorAll(seletores.join(','));
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var titulo = el.getAttribute('title');
            if (titulo && titulo.trim()) {
                el.setAttribute('data-title', titulo);
                el.removeAttribute('title');
            }
        }
    }

    /* Executa quando o DOM estiver pronto */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ativarTooltips);
    } else {
        ativarTooltips();
    }

    /* Observa novos elementos adicionados dinamicamente */
    if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function(mutations) {
            var needsUpdate = false;
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes.length > 0) {
                    needsUpdate = true;
                    break;
                }
            }
            if (needsUpdate) ativarTooltips();
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                observer.observe(document.body, { childList: true, subtree: true });
            });
        } else {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }
})();

/**
 * ALUFORCE — Toggle Mobile Sidebar (Global)
 * Disponível globalmente para todas as páginas com sidebar-overlay + #mobile-sidebar.
 */
function toggleMobileSidebar() {
    var sidebar = document.getElementById('mobile-sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

function closeMobileSidebar() {
    var sidebar = document.getElementById('mobile-sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}