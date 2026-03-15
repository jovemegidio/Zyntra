/* ============================================
   PCP COMMON JS - Funções Compartilhadas
   ============================================ */

// API Base URL - Usa URL relativa em produção para evitar Mixed Content
function getAPIBase() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000';
    }
    // Em produção, usar URL relativa (o servidor já está no mesmo domínio)
    return '';
}

// Toggle Mobile Sidebar
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) {
        sidebar.classList.toggle('open');
    }
    if (overlay) {
        overlay.classList.toggle('active');
    }
}

// Atualizar saudação baseada na hora
async function atualizarSaudacao() {
    const hora = new Date().getHours();
    let saudacao = 'Bom dia';
    if (hora >= 12 && hora < 18) saudacao = 'Boa tarde';
    else if (hora >= 18) saudacao = 'Boa noite';
    
    const saudacaoEl = document.getElementById('saudacao');
    if (saudacaoEl) saudacaoEl.textContent = saudacao + ',';
    
    // Tentar pegar nome do usuário do localStorage primeiro (userData é onde o login salva)
    let user = JSON.parse(localStorage.getItem('userData') || localStorage.getItem('user') || '{}');
    
    // Se não tem dados no localStorage, buscar da API
    if (!user.nome) {
        try {
            const API_BASE = getAPIBase();
            const headers = { 'Accept': 'application/json' };
            // Usar /api/me que é a rota correta
            const response = await fetch(`${API_BASE}/api/me`, { 
                credentials: 'include',
                headers: headers
            });
            if (response.ok) {
                user = await response.json();
                localStorage.setItem('userData', JSON.stringify(user));
            }
        } catch (e) {
            console.warn('Não foi possível carregar dados do usuário:', e);
        }
    }
    
    const userNameEl = document.getElementById('userName');
    const userInitialEl = document.getElementById('userInitial');
    const userAvatarEl = document.querySelector('.user-avatar');
    
    if (user.nome) {
        const primeiroNome = user.nome.split(' ')[0];
        if (userNameEl) userNameEl.textContent = primeiroNome;
        if (userInitialEl) userInitialEl.textContent = primeiroNome.charAt(0).toUpperCase();
    }
    
    // Verificar se existe avatar
    if (userAvatarEl && user.avatar) {
        userAvatarEl.innerHTML = `<img src="${user.avatar}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    } else if (userAvatarEl && user.foto) {
        userAvatarEl.innerHTML = `<img src="${user.foto}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    }
}

// Formatar moeda
function formatarMoeda(valor) {
    return 'R$ ' + (parseFloat(valor) || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Formatar data
function formatarData(data) {
    if (!data) return '-';
    return new Date(data).toLocaleDateString('pt-BR');
}

// Formatar data e hora
function formatarDataHora(data) {
    if (!data) return '-';
    return new Date(data).toLocaleString('pt-BR');
}

// Toast notification
function showToast(message, type = 'info') {
    // Remover toast anterior se existir
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    var icon = document.createElement('i');
    icon.className = 'fas fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle');
    var span = document.createElement('span');
    span.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(span);
    
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 10000;
        animation: slideInUp 0.3s ease;
        font-weight: 500;
        font-size: 14px;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOutDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Adicionar animações CSS
const styleEl = document.createElement('style');
styleEl.textContent = `
    @keyframes slideInUp {
        from {
            transform: translateY(100%);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutDown {
        from {
            transform: translateY(0);
            opacity: 1;
        }
        to {
            transform: translateY(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(styleEl);

// Loading overlay
function showLoading(message = 'Carregando...') {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner" style="width: 48px; height: 48px;"></div>
                <p class="loading-message">${message}</p>
            </div>
        `;
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
            backdrop-filter: blur(4px);
        `;
        overlay.querySelector('.loading-content').style.cssText = `
            background: white;
            padding: 32px;
            border-radius: 16px;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        `;
        overlay.querySelector('.loading-message').style.cssText = `
            margin-top: 16px;
            font-size: 14px;
            color: #64748b;
        `;
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Confirm modal
let confirmModalCallback = null;

function showConfirmModal(options = {}) {
    const {
        title = 'Confirmar ação',
        message = 'Tem certeza que deseja continuar?',
        type = 'warning',
        confirmText = 'Confirmar',
        cancelText = 'Cancelar',
        onConfirm = null
    } = options;
    
    confirmModalCallback = onConfirm;
    
    const overlay = document.getElementById('confirm-modal-overlay');
    const iconEl = document.getElementById('confirm-modal-icon');
    const iconI = document.getElementById('confirm-modal-icon-i');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    
    if (overlay) {
        iconEl.className = `confirm-modal-icon ${type}`;
        iconI.className = `fas fa-${type === 'danger' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-triangle' : type === 'success' ? 'check' : 'info-circle'}`;
        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.className = `confirm-modal-btn confirm-modal-btn-${type === 'danger' ? 'danger' : 'confirm'}`;
        confirmBtn.innerHTML = `<i class="fas fa-check"></i> ${confirmText}`;
        
        overlay.classList.add('active');
    }
}

function closeConfirmModal() {
    const overlay = document.getElementById('confirm-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
    confirmModalCallback = null;
}

function handleConfirmModalConfirm() {
    if (confirmModalCallback) {
        confirmModalCallback();
    }
    closeConfirmModal();
}

// Event listeners para confirm modal
document.addEventListener('DOMContentLoaded', function() {
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const overlay = document.getElementById('confirm-modal-overlay');
    
    if (confirmBtn) {
        confirmBtn.addEventListener('click', handleConfirmModalConfirm);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeConfirmModal);
    }
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeConfirmModal();
        });
    }
});

// Exportar para Excel (básico)
function exportarParaExcel(dados, nomeArquivo = 'exportacao') {
    if (!dados || dados.length === 0) {
        showToast('Nenhum dado para exportar', 'warning');
        return;
    }
    
    // Criar CSV
    const headers = Object.keys(dados[0]);
    const csv = [
        headers.join(';'),
        ...dados.map(row => headers.map(h => {
            let val = row[h] || '';
            if (typeof val === 'string' && val.includes(';')) {
                val = `"${val}"`;
            }
            return val;
        }).join(';'))
    ].join('\n');
    
    // Download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${nomeArquivo}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    
    showToast('Arquivo exportado com sucesso!', 'success');
}

// Verificar autenticação
// v2: Se não há token no localStorage, tenta validar sessão via cookie no servidor
// antes de redirecionar para login (compatível com auth-unified.js v7.2)
function verificarAuth() {
    if (token) return true;
    
    // Se auth-unified.js está carregado, ele já cuida da validação via cookie
    if (window.AluforceAuth) return true;
    
    // Fallback: verificar via servidor antes de redirecionar
    fetch('/api/me', { credentials: 'include', headers: { 'Accept': 'application/json' } })
        .then(r => {
            if (r.ok) return r.json();
            throw new Error('Não autenticado');
        })
        .then(user => {
            if (user) {
                localStorage.setItem('userData', JSON.stringify(user));
                localStorage.setItem('token', 'session-cookie-active');
                window.location.reload();
            }
        })
        .catch(() => {
            window.location.href = '../../login.html';
        });
    return false;
}

// Fazer requisição autenticada
// v2: Sempre envia credentials:include para que o cookie httpOnly seja enviado
async function fetchAuth(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers
    });
    
    if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Não redirecionar imediatamente - auth-unified.js cuidará disso
        if (!window.AluforceAuth) {
            window.location.href = '../../login.html';
        }
        throw new Error('Não autorizado');
    }
    
    return response;
}

// Debounce para buscas
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

// Inicialização comum
document.addEventListener('DOMContentLoaded', function() {
    // Atualizar saudação
    atualizarSaudacao();
    
    // Fechar sidebar ao clicar fora (mobile)
    document.addEventListener('click', function(e) {
        const sidebar = document.querySelector('.sidebar');
        const menuBtn = document.querySelector('.mobile-menu-btn');
        
        if (sidebar && sidebar.classList.contains('open')) {
            if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
                toggleMobileSidebar();
            }
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // ESC para fechar modais
        if (e.key === 'Escape') {
            closeConfirmModal();
            const modals = document.querySelectorAll('.modal-overlay.active');
            modals.forEach(m => m.classList.remove('active'));
        }
    });
});

// Expor funções globalmente
window.getAPIBase = getAPIBase;
window.toggleMobileSidebar = toggleMobileSidebar;
window.atualizarSaudacao = atualizarSaudacao;
window.formatarMoeda = formatarMoeda;
window.formatarData = formatarData;
window.formatarDataHora = formatarDataHora;
window.showToast = showToast;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.showConfirmModal = showConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.exportarParaExcel = exportarParaExcel;
window.verificarAuth = verificarAuth;
window.fetchAuth = fetchAuth;
window.debounce = debounce;

// ============================================
// NOTIFICAÇÕES PCP - COMPARTILHADO
// ============================================
(function initNotificacoesPCP() {
    // Procurar botão de sino existente sem handler
    document.addEventListener('DOMContentLoaded', function() {
        // Se já tem notification-container configurada (index.html), não interferir
        if (document.querySelector('.notification-container .notification-btn')) return;

        // Encontrar botão de sino órfão nas sub-páginas
        const bellBtns = document.querySelectorAll('.header-btn[title="Notificações"]');
        bellBtns.forEach(btn => {
            if (btn.onclick || btn.classList.contains('notification-btn')) return;

            // Envolver com container
            const container = document.createElement('div');
            container.className = 'notification-container';
            container.style.cssText = 'position: relative;';
            btn.parentNode.insertBefore(container, btn);
            container.appendChild(btn);

            // Adicionar badge
            btn.classList.add('notification-btn');
            const badge = document.createElement('span');
            badge.className = 'notification-badge';
            badge.id = 'notification-count';
            badge.style.cssText = 'display: none; position: absolute; top: -4px; right: -4px; background: #ef4444; color: white; font-size: 10px; font-weight: 700; width: 18px; height: 18px; border-radius: 50%; align-items: center; justify-content: center; border: 2px solid white;';
            badge.textContent = '0';
            btn.style.position = 'relative';
            btn.appendChild(badge);

            // Criar painel dropdown
            const panel = document.createElement('div');
            panel.className = 'notification-panel';
            panel.id = 'notification-panel';
            panel.style.cssText = 'display: none; position: absolute; top: calc(100% + 8px); right: 0; width: 360px; max-width: 90vw; background: white; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); z-index: 9999; overflow: hidden; border: 1px solid rgba(0,0,0,0.08);';
            panel.innerHTML = `
                <div style="padding: 16px 20px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; background: #f8fafc;">
                    <h3 style="font-size: 14px; font-weight: 700; color: #1e293b; margin: 0;"><i class="fas fa-bell" style="margin-right: 8px; color: #3b82f6;"></i>Notificações</h3>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="pcpMarcarTodasLidas()" title="Marcar todas como lidas" style="background: none; border: none; cursor: pointer; padding: 4px; color: #94a3b8;"><i class="fas fa-check-double"></i></button>
                        <button onclick="pcpLimparNotificacoes()" title="Limpar todas" style="background: none; border: none; cursor: pointer; padding: 4px; color: #94a3b8;"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
                <div id="notification-list" style="max-height: 400px; overflow-y: auto;">
                    <div style="text-align: center; padding: 24px; color: #94a3b8;">
                        <i class="fas fa-check-circle" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
                        <p style="margin: 0; font-size: 13px;">Nenhuma notificação</p>
                    </div>
                </div>
            `;
            container.appendChild(panel);

            // Handler de clique
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const isVisible = panel.style.display === 'block';
                panel.style.display = isVisible ? 'none' : 'block';
                if (!isVisible) pcpCarregarNotificacoes();
            });

            // Fechar ao clicar fora
            document.addEventListener('click', function(e) {
                if (!container.contains(e.target)) {
                    panel.style.display = 'none';
                }
            });
        });

        // Carregar badge inicial
        pcpCarregarBadge();
    });
})();

async function pcpCarregarNotificacoes() {
    const list = document.getElementById('notification-list');
    if (!list) return;

    list.innerHTML = '<div style="text-align: center; padding: 24px;"><div class="loading-spinner" style="margin: 0 auto; width: 24px; height: 24px;"></div></div>';

    try {
        const headers = { 'Content-Type': 'application/json' };

        const response = await fetch('/api/pcp/alertas', { credentials: 'include', headers });
        if (!response.ok) throw new Error('Erro ' + response.status);

        const data = await response.json();
        const alertas = data.alertas || [];

        // Badge
        const badge = document.getElementById('notification-count');
        if (badge) {
            const total = alertas.reduce((sum, a) => sum + (a.total || 1), 0);
            badge.textContent = total > 99 ? '99+' : total;
            badge.style.display = total > 0 ? 'flex' : 'none';
            badge.style.background = data.totalCriticos > 0 ? '#ef4444' : '#f59e0b';
        }

        if (alertas.length === 0) {
            list.innerHTML = '<div style="text-align: center; padding: 24px; color: #94a3b8;"><i class="fas fa-check-circle" style="font-size: 24px; margin-bottom: 8px; display: block;"></i><p style="margin: 0; font-size: 13px;">Nenhuma notificação</p></div>';
            return;
        }

        list.innerHTML = alertas.map(a => `
            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; cursor: pointer;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <div style="width: 32px; height: 32px; border-radius: 50%; background: ${a.cor}15; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas ${a.icone}" style="color: ${a.cor}; font-size: 13px;"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; font-size: 12px; color: #1e293b; margin-bottom: 2px;">
                        ${a.titulo} <span style="background: ${a.cor}; color: white; padding: 1px 6px; border-radius: 10px; font-size: 10px; margin-left: 4px;">${a.total}</span>
                    </div>
                    <div style="color: #64748b; font-size: 11px;">${a.descricao}</div>
                    ${a.detalhes ? `<div style="color: #94a3b8; font-size: 10px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${a.detalhes}</div>` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Erro notificações:', e);
        list.innerHTML = '<div style="text-align: center; padding: 24px; color: #94a3b8;"><i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 8px; display: block;"></i><p style="margin: 0; font-size: 13px;">Erro ao carregar</p></div>';
    }
}

async function pcpCarregarBadge() {
    try {
        const headers = { 'Content-Type': 'application/json' };

        const response = await fetch('/api/pcp/alertas', { credentials: 'include', headers });
        if (response.ok) {
            const data = await response.json();
            const alertas = data.alertas || [];
            const badge = document.getElementById('notification-count');
            if (badge) {
                const total = alertas.reduce((sum, a) => sum + (a.total || 1), 0);
                badge.textContent = total > 99 ? '99+' : total;
                badge.style.display = total > 0 ? 'flex' : 'none';
                badge.style.background = data.totalCriticos > 0 ? '#ef4444' : '#f59e0b';
            }
        }
    } catch (e) { console.warn('Badge notificações:', e); }
}

function pcpMarcarTodasLidas() {
    const badge = document.getElementById('notification-count');
    if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
}

function pcpLimparNotificacoes() {
    const list = document.getElementById('notification-list');
    if (list) {
        list.innerHTML = '<div style="text-align: center; padding: 24px; color: #94a3b8;"><i class="fas fa-check-circle" style="font-size: 24px; margin-bottom: 8px; display: block;"></i><p style="margin: 0; font-size: 13px;">Nenhuma notificação</p></div>';
    }
    pcpMarcarTodasLidas();
}

window.pcpCarregarNotificacoes = pcpCarregarNotificacoes;
window.pcpCarregarBadge = pcpCarregarBadge;
window.pcpMarcarTodasLidas = pcpMarcarTodasLidas;
window.pcpLimparNotificacoes = pcpLimparNotificacoes;
