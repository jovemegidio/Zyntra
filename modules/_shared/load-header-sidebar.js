/**
 * Script para carregar Header e Sidebar compartilhados
 * Inclui automaticamente o header e sidebar padrão nos módulos
 */

(function() {
    'use strict';
    
    // Função para carregar o header e sidebar
    async function loadHeaderSidebar() {
        try {
            const response = await fetch('/modules/_shared/header-sidebar.html');
            if (!response.ok) {
                console.warn('Não foi possível carregar header/sidebar compartilhado');
                return;
            }
            
            const html = await response.text();
            
            // Inserir no início do body ou em um container específico
            const container = document.querySelector('.container-principal');
            if (container) {
                container.insertAdjacentHTML('afterbegin', html);
            } else {
                document.body.insertAdjacentHTML('afterbegin', html);
            }
            
            console.log('✅ Header e Sidebar carregados');
        } catch (error) {
            console.error('❌ Erro ao carregar header/sidebar:', error);
        }
    }
    
    // Carregar quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadHeaderSidebar);
    } else {
        loadHeaderSidebar();
    }
})();
