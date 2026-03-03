/**
 * Admin Permissions Manager
 * Controls visibility of admin-only UI elements
 */

(function() {
    'use strict';

    const AdminPermissions = {
        currentUser: null,
        isInitialized: false,

        async init() {
            if (this.isInitialized) return;

            try {
                await this.loadUserPermissions();
                this.applyPermissions();
                this.isInitialized = true;
                console.log('[AdminPermissions] Initialized successfully');
            } catch (error) {
                console.error('[AdminPermissions] Initialization error:', error);
            }
        },

        async loadUserPermissions() {
            try {
                const response = await fetch('/api/me', {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken') || localStorage.getItem('token') || ''}`
                    },
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch user data');
                }

                this.currentUser = await response.json();
                console.log('[AdminPermissions] User loaded:', this.currentUser.email, 'is_admin:', this.currentUser.is_admin);
                
            } catch (error) {
                console.error('[AdminPermissions] Error loading user:', error);
                throw error;
            }
        },

        applyPermissions() {
            if (!this.currentUser) {
                console.warn('[AdminPermissions] No user data available');
                return;
            }

            // Lista de e-mails admins fixos (apenas funcionários internos)
            const adminEmails = [
                'douglas@aluforce.ind.br',
                'andreia@aluforce.ind.br',
                'fernando@aluforce.ind.br',
                'fernando.kofugi@aluforce.ind.br',
                'ti@aluforce.ind.br',
                'adm@aluforce.ind.br',
                'antonio@aluforce.ind.br'
            ];

            // Usar email do login (localStorage) em vez do /api/me
            // porque /api/me retorna funcionarios com IDs diferentes
            let loginEmail = '';
            try {
                const userData = JSON.parse(localStorage.getItem('userData') || '{}');
                loginEmail = (userData.email || '').toLowerCase();
            } catch(e) {}
            const email = loginEmail || (this.currentUser.email || '').toLowerCase();

            // Consultoria (Lumière) NÃO deve ter acesso admin
            const isConsultoria = email.includes('lumiere');
            const isAdminEmail = adminEmails.includes(email);
            const isAdmin = !isConsultoria && (
                           isAdminEmail ||
                           this.currentUser.is_admin === 1 || 
                           this.currentUser.is_admin === '1' || 
                           this.currentUser.role === 'admin'
                           );

            console.log('[AdminPermissions] User is admin:', isAdmin, 'isConsultoria:', isConsultoria, 'email:', email);

            // Find all elements with data-admin-only attribute
            const adminOnlyElements = document.querySelectorAll('[data-admin-only="true"]');
            
            console.log('[AdminPermissions] Found', adminOnlyElements.length, 'admin-only elements');

            adminOnlyElements.forEach(element => {
                if (isAdmin) {
                    // Show element for admins
                    element.style.display = '';
                    element.removeAttribute('aria-hidden');
                    
                    // Log which elements are being shown
                    console.log('[AdminPermissions] Showing admin element:', element.id || element.className);
                } else {
                    // Keep hidden for non-admins
                    element.style.display = 'none';
                    element.setAttribute('aria-hidden', 'true');
                    
                    // Remove click handlers for security
                    element.style.pointerEvents = 'none';
                }
            });

            // Store admin status globally for other scripts
            window.isUserAdmin = isAdmin;
            
            // Dispatch custom event for other components
            window.dispatchEvent(new CustomEvent('admin-permissions-loaded', {
                detail: { isAdmin, user: this.currentUser }
            }));
        },

        isAdmin() {
            if (!this.currentUser) return false;
            return this.currentUser.is_admin === 1 || 
                   this.currentUser.is_admin === '1' || 
                   this.currentUser.role === 'admin';
        },

        async refresh() {
            await this.loadUserPermissions();
            this.applyPermissions();
        }
    };

    // Initialize after user data is loaded
    // We'll hook into existing updateUserUI or wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Wait a bit for updateUserUI to complete
            setTimeout(() => AdminPermissions.init(), 500);
        });
    } else {
        setTimeout(() => AdminPermissions.init(), 500);
    }

    // Export to window
    window.AdminPermissions = AdminPermissions;

})();
