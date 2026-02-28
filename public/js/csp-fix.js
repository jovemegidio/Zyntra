/**
 * CSP FIX v2 - Compatibilidade de eventos inline SEM uso de eval/new Function
 * 
 * A CSP do servidor já inclui scriptSrcAttr: ['unsafe-inline'] que permite
 * atributos de eventos inline (onclick, onchange, etc.) nativamente.
 * 
 * Este script NÃO precisa mais converter handlers — apenas monitora e
 * reporta para debug. Não usa eval(), new Function() nem setTimeout(string).
 * 
 * AUDIT-FIX SEC-004: Removido uso de new Function() que requeria 'unsafe-eval'.
 */

(function() {
    'use strict';
    
    // Lista de todos os eventos inline monitorados
    const EVENT_ATTRIBUTES = [
        'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover', 
        'onmouseout', 'onmousemove', 'onmouseenter', 'onmouseleave',
        'onkeydown', 'onkeyup', 'onkeypress',
        'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit', 'onreset',
        'onscroll', 'onresize', 'onload', 'onerror',
        'ondrag', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 
        'ondragstart', 'ondrop',
        'ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel'
    ];

    let inlineHandlerCount = 0;

    /**
     * Conta eventos inline em um elemento (para diagnóstico).
     * NÃO converte — scriptSrcAttr: ['unsafe-inline'] permite nativamente.
     */
    function countEventsOnElement(element) {
        let count = 0;
        EVENT_ATTRIBUTES.forEach(function(attr) {
            if (element.hasAttribute && element.hasAttribute(attr)) {
                count++;
            }
        });
        return count;
    }

    /**
     * Escaneia a página e reporta quantidade de handlers inline.
     */
    function scanInlineEvents() {
        var selector = EVENT_ATTRIBUTES.map(function(attr) { return '[' + attr + ']'; }).join(',');
        try {
            var elements = document.querySelectorAll(selector);
            inlineHandlerCount = 0;
            elements.forEach(function(el) {
                inlineHandlerCount += countEventsOnElement(el);
            });
        } catch (e) {
            // Selector pode falhar se DOM não estiver pronto
        }
    }

    // Escanear quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanInlineEvents);
    } else {
        scanInlineEvents();
    }

    // Exportar API compatível para uso externo
    window.CSP_FIX = {
        convertElement: function() { return true; }, // No-op — handlers já funcionam
        processAll: scanInlineEvents,
        getConvertedCount: function() { return inlineHandlerCount; },
        supportedEvents: EVENT_ATTRIBUTES
    };
})();
