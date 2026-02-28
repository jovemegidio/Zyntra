/**
 * Script para verificar permissões de administrador no módulo de Vendas
 * Oculta o botão "Gestão de Vendas" na sidebar para usuários não autorizados
 * v2.0 — Injeta CSS imediatamente para evitar flash/pulo visual na sidebar
 */

(function() {
    'use strict';
    
    // === PASSO 1: Injetar CSS IMEDIATAMENTE para esconder o botão antes do DOM renderizar ===
    // Isso previne o "flash" onde o botão aparece e depois some
    var hideStyle = document.createElement('style');
    hideStyle.id = 'vendas-gestao-hide-css';
    hideStyle.textContent = [
        'button[onclick*="dashboard-admin.html"],',
        'a[href*="dashboard-admin.html"],',
        'button[title="Gestão de Vendas"],',
        'button[title="Gestão"],',
        'button[data-title="Gestão de Vendas"],',
        'button[data-title="Gestão"] {',
        '  display: none !important;',
        '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(hideStyle);
    
    // Lista de admins autorizados a ver o Dashboard Admin de Vendas
    const ADMINS_AUTORIZADOS = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin'];
    
    function isAdminAutorizado(user) {
        if (!user) return false;
        
        // Verificar is_admin
        if (user.is_admin === true || user.is_admin === 1) return true;
        
        // Verificar email
        if (user.email) {
            const username = user.email.split('@')[0].toLowerCase().replace(/\./g, '');
            if (ADMINS_AUTORIZADOS.some(admin => username.includes(admin))) return true;
        }
        
        // Verificar login
        if (user.login) {
            const login = user.login.toLowerCase();
            if (ADMINS_AUTORIZADOS.includes(login)) return true;
        }
        
        return false;
    }
    
    function mostrarBotaoGestao() {
        // Remover o CSS que esconde o botão — admin confirmado
        var style = document.getElementById('vendas-gestao-hide-css');
        if (style) style.remove();
    }
    
    async function verificarPermissaoAdmin() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (response.ok) {
                const user = await response.json();
                
                // Se É admin autorizado, MOSTRAR o botão (remover CSS de ocultação)
                if (isAdminAutorizado(user)) {
                    mostrarBotaoGestao();
                }
                // Se NÃO é admin, o CSS já está ocultando — não precisa fazer nada
                
                // Expor função globalmente para uso em outras partes do código
                window.isVendasAdminAutorizado = true;
                window.currentVendasUser = user;
                window.isCurrentUserVendasAdmin = isAdminAutorizado(user);
            }
        } catch (error) {
            console.error('Erro ao verificar permissões de admin:', error);
            // Em caso de erro, manter oculto por segurança (CSS já está ativo)
        }
    }
    
    // Executar quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', verificarPermissaoAdmin);
    } else {
        verificarPermissaoAdmin();
    }
    
    // Expor função para verificação externa
    window.isVendasAdmin = isAdminAutorizado;
})();
