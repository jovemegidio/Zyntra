// =================================================================
// SISTEMA DE PERMISSÕES HÍBRIDO - ALUFORCE v2.0
// Suporta RBAC (banco) + Sistema Legado (permissions.js)
// =================================================================

(function() {
    'use strict';

    // Cache de permissões carregadas do servidor
    let cachedPermissions = null;
    let permissionsLoaded = false;
    let permissionsPromise = null;

    /**
     * Carrega permissões do servidor (RBAC)
     * @returns {Promise<Object|null>}
     */
    async function loadPermissionsFromServer() {
        // Se já está carregando, aguardar
        if (permissionsPromise) {
            return permissionsPromise;
        }

        // Se já carregou, retornar cache
        if (permissionsLoaded) {
            return cachedPermissions;
        }

        permissionsPromise = (async () => {
            try {
                const response = await fetch('/api/auth/permissions', {
                    credentials: 'include'
                });

                if (!response.ok) {
                    console.log('[Permissions] Servidor retornou erro, usando sistema legado');
                    return null;
                }

                const data = await response.json();
                
                if (data.success && data.permissions && data.permissions.useRBAC) {
                    cachedPermissions = data.permissions;
                    console.log('[Permissions] RBAC carregado do servidor');
                    return cachedPermissions;
                }

                console.log('[Permissions] RBAC não configurado, usando sistema legado');
                return null;

            } catch (err) {
                console.log('[Permissions] Erro ao carregar RBAC:', err.message);
                return null;
            } finally {
                permissionsLoaded = true;
                permissionsPromise = null;
            }
        })();

        return permissionsPromise;
    }

    /**
     * Verifica se usuário tem acesso a uma área (híbrido)
     * @param {String} area - Código da área (pcp, vendas, etc)
     * @param {String} userName - Nome do usuário (opcional)
     * @returns {Promise<Boolean>}
     */
    async function hasAccessAsync(area, userName) {
        // Tentar RBAC primeiro
        const rbacPerms = await loadPermissionsFromServer();
        
        if (rbacPerms && rbacPerms.modules) {
            // RBAC disponível
            const module = rbacPerms.modules[area];
            return module ? module.visualizar : false;
        }

        // Fallback para sistema legado
        if (typeof window.UserPermissions !== 'undefined') {
            return window.UserPermissions.hasAccess(area, userName);
        }

        // Se nada disponível, negar acesso
        return false;
    }

    /**
     * Verifica acesso síncrono (usa cache ou sistema legado)
     * @param {String} area - Código da área
     * @param {String} userName - Nome do usuário
     * @returns {Boolean}
     */
    function hasAccess(area, userName) {
        // Tentar RBAC do cache
        if (cachedPermissions && cachedPermissions.modules) {
            const module = cachedPermissions.modules[area];
            return module ? module.visualizar : false;
        }

        // Fallback para sistema legado
        if (typeof window.UserPermissions !== 'undefined') {
            return window.UserPermissions.hasAccess(area, userName);
        }

        return false;
    }

    /**
     * Obtém todas as áreas do usuário
     * @param {String} userName - Nome do usuário
     * @returns {Promise<Array>}
     */
    async function getUserAreasAsync(userName) {
        const rbacPerms = await loadPermissionsFromServer();
        
        if (rbacPerms && rbacPerms.modules) {
            return Object.keys(rbacPerms.modules).filter(
                mod => rbacPerms.modules[mod].visualizar
            );
        }

        // Fallback
        if (typeof window.UserPermissions !== 'undefined') {
            return window.UserPermissions.getUserAreas(userName);
        }

        return [];
    }

    /**
     * Verifica se é admin
     * @param {String} userName - Nome do usuário
     * @returns {Promise<Boolean>}
     */
    async function isAdminAsync(userName) {
        const rbacPerms = await loadPermissionsFromServer();
        
        if (rbacPerms) {
            return rbacPerms.highestLevel >= 90; // Admin ou Super Admin
        }

        // Fallback
        if (typeof window.UserPermissions !== 'undefined') {
            return window.UserPermissions.isAdmin(userName);
        }

        return false;
    }

    /**
     * Verifica permissão específica no módulo
     * @param {String} modulo - Código do módulo
     * @param {String} acao - Ação (visualizar, criar, editar, excluir, aprovar)
     * @returns {Promise<Boolean>}
     */
    async function checkPermission(modulo, acao = 'visualizar') {
        const rbacPerms = await loadPermissionsFromServer();
        
        if (rbacPerms && rbacPerms.modules) {
            const module = rbacPerms.modules[modulo];
            if (!module) return false;
            return !!module[acao];
        }

        // Sistema legado não tem granularidade de ações
        // Assume que se tem acesso ao módulo, tem todas as permissões
        if (typeof window.UserPermissions !== 'undefined') {
            const user = JSON.parse(localStorage.getItem('userData') || '{}');
            return window.UserPermissions.hasAccess(modulo, user.nome);
        }

        return false;
    }

    /**
     * Obtém roles do usuário
     * @returns {Promise<Array>}
     */
    async function getUserRoles() {
        const rbacPerms = await loadPermissionsFromServer();
        return rbacPerms?.roles || [];
    }

    /**
     * Limpa cache de permissões (chamar após logout ou mudança de permissões)
     */
    function clearPermissionsCache() {
        cachedPermissions = null;
        permissionsLoaded = false;
        permissionsPromise = null;
    }

    /**
     * Aplica permissões nos módulos da página (cards do dashboard)
     * @param {String} userName - Nome do usuário
     */
    async function applyModulePermissions(userName) {
        try {
            // Carregar permissões
            await loadPermissionsFromServer();

            // Buscar todos os cards de módulos
            const moduleCards = document.querySelectorAll('[data-module]');
            
            for (const card of moduleCards) {
                const moduleName = card.dataset.module;
                const hasPermission = await hasAccessAsync(moduleName, userName);
                
                if (!hasPermission) {
                    card.style.display = 'none';
                    card.classList.add('module-hidden');
                } else {
                    card.style.display = '';
                    card.classList.remove('module-hidden');
                }
            }

            // Verificar se é admin para mostrar área administrativa
            const isAdmin = await isAdminAsync(userName);
            const adminElements = document.querySelectorAll('[data-admin-only]');
            
            adminElements.forEach(el => {
                el.style.display = isAdmin ? '' : 'none';
            });

            // Disparar evento para notificar que permissões foram aplicadas
            document.dispatchEvent(new CustomEvent('permissions:applied', {
                detail: { userName, isAdmin }
            }));

        } catch (err) {
            console.error('[Permissions] Erro ao aplicar permissões:', err);
        }
    }

    /**
     * Verifica e redireciona se não tem permissão para módulo atual
     * @param {String} moduleName - Nome do módulo
     * @param {String} redirectUrl - URL de redirecionamento (padrão: /index.html)
     */
    async function requireModuleAccess(moduleName, redirectUrl = '/index.html') {
        const hasPermission = await hasAccessAsync(moduleName);
        
        if (!hasPermission) {
            console.warn(`[Permissions] Acesso negado ao módulo: ${moduleName}`);
            
            // Mostrar mensagem antes de redirecionar
            if (typeof Swal !== 'undefined') {
                await Swal.fire({
                    icon: 'error',
                    title: 'Acesso Negado',
                    text: 'Você não tem permissão para acessar este módulo.',
                    confirmButtonText: 'Voltar ao Painel'
                });
            } else {
                alert('Você não tem permissão para acessar este módulo.');
            }
            
            window.location.href = redirectUrl;
            return false;
        }

        return true;
    }

    /**
     * Esconde elementos baseado em permissão
     * @param {String} selector - Seletor CSS
     * @param {String} modulo - Módulo requerido
     * @param {String} acao - Ação requerida (opcional)
     */
    async function hideIfNoPermission(selector, modulo, acao = 'visualizar') {
        const elements = document.querySelectorAll(selector);
        const hasPermission = await checkPermission(modulo, acao);
        
        elements.forEach(el => {
            el.style.display = hasPermission ? '' : 'none';
        });
    }

    // =========================================================================
    // EXPORTAR API
    // =========================================================================

    const PermissionsAPI = {
        // Funções assíncronas (preferidas)
        loadFromServer: loadPermissionsFromServer,
        hasAccessAsync,
        getUserAreasAsync,
        isAdminAsync,
        checkPermission,
        getUserRoles,
        
        // Funções síncronas (usam cache ou legado)
        hasAccess,
        
        // Utilitários
        clearCache: clearPermissionsCache,
        applyModulePermissions,
        requireModuleAccess,
        hideIfNoPermission,
        
        // Acesso ao cache (para debug)
        getCache: () => cachedPermissions
    };

    // Exportar globalmente
    window.PermissionsAPI = PermissionsAPI;

    // Alias para compatibilidade
    window.Permissions = PermissionsAPI;

    // Auto-inicialização quando DOM carrega
    document.addEventListener('DOMContentLoaded', async () => {
        // Pré-carregar permissões
        try {
            await loadPermissionsFromServer();
            console.log('[Permissions] Sistema de permissões inicializado');
        } catch (err) {
            console.warn('[Permissions] Não foi possível pré-carregar permissões');
        }
    });

})();
