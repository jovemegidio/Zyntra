/**
 * ALUFORCE Financeiro - Funções Compartilhadas
 * ==============================================
 * Funções de sidebar, notificações, configurações e mobile
 * que são necessárias em TODAS as páginas do módulo Financeiro.
 * 
 * @version 20260217
 * @author ALUFORCE
 */

(function() {
    'use strict';

    // ======== TOGGLE MOBILE SIDEBAR ========
    window.toggleMobileSidebar = function() {
        const sidebar = document.querySelector('.sidebar, #mobile-sidebar');
        const overlay = document.querySelector('.sidebar-overlay, #sidebar-overlay');
        if (sidebar) sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
    };

    // ======== TOGGLE NOTIFICAÇÕES ========
    window.toggleNotificacoes = function() {
        const panel = document.getElementById('notification-panel');
        if (panel) {
            panel.classList.toggle('active');
            // Fechar ao clicar fora
            if (panel.classList.contains('active')) {
                setTimeout(() => {
                    document.addEventListener('click', fecharNotificacoesAoClicarFora, { once: true });
                }, 100);
            }
        }
    };

    function fecharNotificacoesAoClicarFora(e) {
        const panel = document.getElementById('notification-panel');
        const btn = document.querySelector('.notification-btn');
        if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
            panel.classList.remove('active');
        } else if (panel && panel.classList.contains('active')) {
            document.addEventListener('click', fecharNotificacoesAoClicarFora, { once: true });
        }
    }

    // ======== MARCAR TODAS NOTIFICAÇÕES COMO LIDAS ========
    window.marcarTodasLidas = function() {
        const items = document.querySelectorAll('.notification-item.unread');
        items.forEach(item => item.classList.remove('unread'));
        
        const badge = document.getElementById('notification-count');
        if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
        
        // Mostrar mensagem de vazio se não há notificações
        const list = document.getElementById('notification-list');
        if (list && items.length > 0) {
            mostrarToastFinanceiro('Todas as notificações marcadas como lidas', 'success');
        }
    };

    // ======== LIMPAR NOTIFICAÇÕES ========
    window.limparNotificacoes = function() {
        const list = document.getElementById('notification-list');
        if (list) {
            list.innerHTML = `
                <div class="notification-empty">
                    <i class="fas fa-check-circle"></i>
                    <p>Nenhuma notificação</p>
                </div>
            `;
        }
        const badge = document.getElementById('notification-count');
        if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
        mostrarToastFinanceiro('Notificações limpas', 'success');
    };

    // ======== TOGGLE CONFIGURAÇÕES ========
    window.toggleConfiguracoes = function() {
        // Redireciona para a página de configurações do sistema
        // ou abre um painel lateral de configurações rápidas
        mostrarToastFinanceiro('Configurações em desenvolvimento', 'info');
    };

    // ======== GREETING (Bom dia / Boa tarde / Boa noite) ========
    function atualizarGreeting() {
        const el = document.getElementById('greeting-text');
        if (!el) return;
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) el.textContent = 'Bom dia';
        else if (hour >= 12 && hour < 18) el.textContent = 'Boa tarde';
        else el.textContent = 'Boa noite';
    }

    // ======== TOAST SIMPLES (fallback) ========
    window.mostrarToastFinanceiro = function(mensagem, tipo) {
        // Usa showToast se existir (bancos.html tem assinatura diferente, então normalizamos)
        if (typeof window.showToast === 'function') {
            try {
                // Tenta com assinatura (message, type)
                window.showToast(mensagem, tipo || 'info');
                return;
            } catch(e) { /* fallback abaixo */ }
        }
        
        // Fallback: cria toast temporário
        const existing = document.querySelector('.financeiro-toast-shared');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'financeiro-toast-shared';
        const colors = {
            success: { bg: '#10b981', icon: 'fa-check-circle' },
            error: { bg: '#ef4444', icon: 'fa-times-circle' },
            warning: { bg: '#f59e0b', icon: 'fa-exclamation-triangle' },
            info: { bg: '#3b82f6', icon: 'fa-info-circle' }
        };
        const c = colors[tipo] || colors.info;
        toast.innerHTML = `<i class="fas ${c.icon}"></i> ${mensagem}`;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
            background: c.bg, color: '#fff', padding: '12px 20px', borderRadius: '8px',
            fontSize: '13px', fontFamily: 'Inter, sans-serif', fontWeight: '500',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center',
            gap: '8px', opacity: '0', transform: 'translateY(10px)', transition: 'all 0.3s ease'
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    };

    // ======== FECHAR MODAIS COM ESC ========
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Suporta múltiplos padrões de modal usados no módulo
            const selectors = [
                '.modal-overlay.active',
                '.modal-overlay-omie.active',
                '.modal-saas.active',
                '.modal-backdrop.active',
                '[class*="modal"][class*="active"]'
            ];
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(modal => {
                    modal.classList.remove('active');
                });
            });
        }
    });

    // ======== NOTIFICATION BADGE FIX ========
    // Corrige o bug onde o badge tem style="display:none" inline
    // que prevalece sobre classes CSS
    function fixNotificationBadge() {
        const badge = document.getElementById('notification-count');
        if (badge && badge.style.display === 'none') {
            const count = parseInt(badge.textContent) || 0;
            if (count > 0) {
                badge.style.display = '';
            }
        }
    }

    // ======== INIT ========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            atualizarGreeting();
            fixNotificationBadge();
        });
    } else {
        atualizarGreeting();
        fixNotificationBadge();
    }

})();
