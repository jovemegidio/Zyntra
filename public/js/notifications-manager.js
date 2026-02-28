/**
 * Sistema de Gerenciamento de Notificações
 * ALUFORCE v2.0
 */

const NotificationsManager = (function() {
    let notifications = [];
    let unreadCount = 0;
    let currentFilter = 'all';
    let isOpen = false;

    // Elementos DOM
    let panel, overlay, listContainer, badge, tabs;

    /**
     * Inicializa o gerenciador de notificações
     */
    function init() {
        console.log('🔔 Inicializando NotificationsManager...');
        
        // Criar elementos DOM
        createPanel();
        
        // Carregar notificações do localStorage
        loadNotifications();
        
        // Configurar event listeners
        setupEventListeners();
        
        // Atualizar badge
        updateBadge();
        
        // Carregar alertas reais dos módulos
        loadAlertsFromModules();
        
        console.log('✅ NotificationsManager inicializado');
    }

    /**
     * Cria o painel de notificações no DOM
     */
    function createPanel() {
        // Criar overlay - COMEÇA OCULTO
        overlay = document.createElement('div');
        overlay.className = 'notifications-overlay';
        overlay.id = 'notifications-overlay';
        overlay.style.cssText = 'visibility: hidden; opacity: 0; pointer-events: none;';
        document.body.appendChild(overlay);

        // Criar painel - COMEÇA OCULTO (à direita da tela)
        panel = document.createElement('div');
        panel.className = 'notifications-panel';
        panel.id = 'notifications-panel';
        panel.style.cssText = 'right: -600px; visibility: hidden; opacity: 0; pointer-events: none; transform: translateX(100%);';
        
        panel.innerHTML = `
            <div class="notifications-panel-header">
                <h3 class="notifications-panel-title">
                    <i class="fas fa-bell"></i>
                    Central de Notificações
                </h3>
                <button class="notifications-panel-close" aria-label="Fechar">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="notifications-stats" id="notifications-stats">
                <div class="notification-stat urgent">
                    <div class="notification-stat-value" id="stat-urgent">0</div>
                    <div class="notification-stat-label">Urgentes</div>
                </div>
                <div class="notification-stat unread">
                    <div class="notification-stat-value" id="stat-unread">0</div>
                    <div class="notification-stat-label">Não Lidas</div>
                </div>
                <div class="notification-stat">
                    <div class="notification-stat-value" id="stat-total">0</div>
                    <div class="notification-stat-label">Total</div>
                </div>
            </div>
            
            <div class="notifications-tabs">
                <button class="notification-tab active" data-filter="all">
                    <i class="fas fa-inbox"></i> Todas
                </button>
                <button class="notification-tab" data-filter="unread">
                    <i class="fas fa-circle"></i> Não lidas
                </button>
                <button class="notification-tab" data-filter="urgent">
                    <i class="fas fa-exclamation-circle"></i> Urgentes
                </button>
                <button class="notification-tab" data-filter="system">
                    <i class="fas fa-cog"></i> Sistema
                </button>
            </div>
            
            <div class="notifications-list" id="notifications-list">
                <!-- Notificações serão inseridas aqui -->
            </div>
            
            <div class="notifications-panel-footer">
                <button class="notifications-footer-btn" id="mark-all-read">
                    <i class="fas fa-check-double"></i>
                    Marcar como lidas
                </button>
                <button class="notifications-footer-btn primary" id="clear-all">
                    <i class="fas fa-sync-alt"></i>
                    Atualizar
                </button>
            </div>
        `;
        
        document.body.appendChild(panel);
        
        // Guardar referências
        listContainer = document.getElementById('notifications-list');
        tabs = panel.querySelectorAll('.notification-tab');
    }

    /**
     * Configura event listeners
     */
    function setupEventListeners() {
        // Botão de notificações no header
        const notifBtn = document.getElementById('notifications-btn');
        if (notifBtn) {
            notifBtn.addEventListener('click', togglePanel);
        }

        // Botão de fechar
        const closeBtn = panel.querySelector('.notifications-panel-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closePanel);
        }

        // Overlay
        overlay.addEventListener('click', closePanel);

        // Tabs de filtro
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const filter = tab.getAttribute('data-filter');
                setFilter(filter);
            });
        });

        // Marcar todas como lidas
        const markAllBtn = document.getElementById('mark-all-read');
        if (markAllBtn) {
            markAllBtn.addEventListener('click', markAllAsRead);
        }

        // Atualizar notificações (botão primário)
        const clearAllBtn = document.getElementById('clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                showLoadingState();
                loadFromServer();
                loadAlertsFromModules();
                showToast('Notificações atualizadas', 'success');
            });
        }
    }

    /**
     * Mostra estado de loading
     */
    function showLoadingState() {
        if (!listContainer) return;
        listContainer.innerHTML = `
            <div class="notification-skeleton">
                <div class="skeleton-icon"></div>
                <div class="skeleton-content">
                    <div class="skeleton-title"></div>
                    <div class="skeleton-text"></div>
                    <div class="skeleton-text"></div>
                </div>
            </div>
            <div class="notification-skeleton">
                <div class="skeleton-icon"></div>
                <div class="skeleton-content">
                    <div class="skeleton-title"></div>
                    <div class="skeleton-text"></div>
                    <div class="skeleton-text"></div>
                </div>
            </div>
            <div class="notification-skeleton">
                <div class="skeleton-icon"></div>
                <div class="skeleton-content">
                    <div class="skeleton-title"></div>
                    <div class="skeleton-text"></div>
                    <div class="skeleton-text"></div>
                </div>
            </div>
        `;
    }

    /**
     * Atualiza as estatísticas do painel
     */
    function updateStats() {
        const urgentCount = notifications.filter(n => n.type === 'error' || n.type === 'warning' || n.priority === 'high').length;
        const unreadCount = notifications.filter(n => !n.read).length;
        const totalCount = notifications.length;
        
        const statUrgent = document.getElementById('stat-urgent');
        const statUnread = document.getElementById('stat-unread');
        const statTotal = document.getElementById('stat-total');
        
        if (statUrgent) statUrgent.textContent = urgentCount;
        if (statUnread) statUnread.textContent = unreadCount;
        if (statTotal) statTotal.textContent = totalCount;
    }

    /**
     * Adiciona uma nova notificação
     * @param {Object} notification - Dados da notificação
     * @param {boolean} syncToServer - Se deve enviar para o servidor (padrão: true)
     */
    function addNotification(notification, syncToServer = true) {
        const newNotif = {
            id: Date.now() + Math.random(),
            title: notification.title || 'Notificação',
            message: notification.message || '',
            type: notification.type || 'info', // info, success, warning, error, system
            time: new Date().toISOString(),
            read: false,
            modulo: notification.modulo || 'sistema',
            link: notification.link || null,
            ...notification
        };

        notifications.unshift(newNotif);
        unreadCount++;
        
        saveNotifications();
        updateBadge();
        renderNotifications();
        
        // Se o painel estiver aberto, animar a nova notificação
        if (isOpen) {
            const firstItem = listContainer.querySelector('.notification-item');
            if (firstItem) {
                firstItem.style.animation = 'slideInRight 0.3s ease-out';
            }
        }

        // Enviar para o servidor se solicitado (para notificações importantes)
        if (syncToServer && notification.persistent) {
            sendToServer(newNotif);
        }

        return newNotif;
    }

    /**
     * Renderiza as notificações na lista
     */
    function renderNotifications() {
        if (!listContainer) return;

        // Atualizar estatísticas
        updateStats();

        // Filtrar notificações
        let filtered = notifications;
        
        if (currentFilter === 'unread') {
            filtered = notifications.filter(n => !n.read);
        } else if (currentFilter === 'system') {
            filtered = notifications.filter(n => n.type === 'system' || n.modulo === 'sistema');
        } else if (currentFilter === 'urgent') {
            filtered = notifications.filter(n => n.type === 'error' || n.type === 'warning' || n.priority === 'high');
        }

        // Se não houver notificações
        if (filtered.length === 0) {
            listContainer.innerHTML = `
                <div class="notifications-empty">
                    <i class="fas fa-bell-slash"></i>
                    <h4>Tudo em dia!</h4>
                    <p>${currentFilter !== 'all' ? 'Nenhuma notificação nesta categoria' : 'Você não possui notificações pendentes'}</p>
                </div>
            `;
            return;
        }

        // Agrupar notificações por data
        const groups = groupNotificationsByDate(filtered);
        
        let html = '';
        for (const [dateLabel, notifs] of Object.entries(groups)) {
            html += `
                <div class="notification-date-group">
                    <div class="notification-date-label">${dateLabel}</div>
                    ${notifs.map(notif => renderNotificationItem(notif)).join('')}
                </div>
            `;
        }
        
        listContainer.innerHTML = html;

        // Adicionar listeners aos itens
        listContainer.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Ignorar se clicar nos botões de ação
                if (e.target.closest('.notification-action-btn')) return;
                
                const id = parseFloat(item.getAttribute('data-id'));
                const link = item.getAttribute('data-link');
                markAsRead(id);
                
                // Se tiver link, navegar para ele
                if (link) {
                    closePanel();
                    window.location.href = link;
                }
            });
        });
        
        // Listeners para botões de ação
        listContainer.querySelectorAll('.notification-action-btn.check').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseFloat(btn.closest('.notification-item').getAttribute('data-id'));
                markAsRead(id);
            });
        });
        
        listContainer.querySelectorAll('.notification-action-btn.view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const link = btn.closest('.notification-item').getAttribute('data-link');
                if (link) {
                    closePanel();
                    window.location.href = link;
                }
            });
        });
    }

    /**
     * Agrupa notificações por data
     */
    function groupNotificationsByDate(notifs) {
        const groups = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        notifs.forEach(n => {
            const date = new Date(n.time);
            date.setHours(0, 0, 0, 0);
            
            let label;
            if (date.getTime() === today.getTime()) {
                label = 'Hoje';
            } else if (date.getTime() === yesterday.getTime()) {
                label = 'Ontem';
            } else if (date >= weekAgo) {
                label = 'Esta Semana';
            } else {
                label = 'Anteriores';
            }
            
            if (!groups[label]) groups[label] = [];
            groups[label].push(n);
        });
        
        return groups;
    }

    /**
     * Renderiza um item de notificação individual
     */
    function renderNotificationItem(notif) {
        const iconClass = notif.icone ? `fas ${notif.icone}` : getIconForType(notif.type);
        const moduloClass = notif.modulo ? notif.modulo.toLowerCase() : 'sistema';
        const priorityClass = notif.priority === 'high' || notif.type === 'error' ? 'priority-high' : '';
        
        const moduloBadge = notif.modulo 
            ? `<span class="notification-module-badge" data-modulo="${moduloClass}">${capitalizeFirst(notif.modulo)}</span>` 
            : '';
        
        return `
            <div class="notification-item ${notif.read ? '' : 'unread'} ${priorityClass}" data-id="${notif.id}" ${notif.link ? `data-link="${notif.link}"` : ''}>
                <div class="notification-icon ${notif.type}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="notification-content">
                    <div class="notification-title">${escapeHtml(notif.title)}</div>
                    <div class="notification-message">${escapeHtml(notif.message)}</div>
                    <div class="notification-meta">
                        ${moduloBadge}
                        <span class="notification-time">
                            <i class="fas fa-clock"></i>
                            ${formatTime(notif.time)}
                        </span>
                    </div>
                </div>
                ${!notif.read ? '<span class="notification-new-badge"></span>' : ''}
                <div class="notification-actions">
                    ${notif.link ? '<button class="notification-action-btn view" title="Ver detalhes"><i class="fas fa-external-link-alt"></i></button>' : ''}
                    ${!notif.read ? '<button class="notification-action-btn check" title="Marcar como lida"><i class="fas fa-check"></i></button>' : ''}
                </div>
            </div>
        `;
    }

    /**
     * Capitaliza primeira letra
     */
    function capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    /**
     * Retorna o ícone apropriado para cada tipo
     */
    function getIconForType(type) {
        const icons = {
            info: 'fas fa-info-circle',
            success: 'fas fa-check-circle',
            warning: 'fas fa-exclamation-triangle',
            error: 'fas fa-times-circle',
            system: 'fas fa-cog'
        };
        return icons[type] || icons.info;
    }

    /**
     * Formata o tempo relativo
     */
    function formatTime(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Agora mesmo';
        if (minutes < 60) return `${minutes}m atrás`;
        if (hours < 24) return `${hours}h atrás`;
        if (days < 7) return `${days}d atrás`;
        
        return date.toLocaleDateString('pt-BR', { 
            day: '2-digit', 
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Escape HTML para prevenir XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Marca uma notificação como lida
     */
    function markAsRead(id) {
        const notif = notifications.find(n => n.id === id);
        if (notif && !notif.read) {
            notif.read = true;
            unreadCount = Math.max(0, unreadCount - 1);
            saveNotifications();
            updateBadge();
            renderNotifications();
        }
    }

    /**
     * Marca todas como lidas
     */
    function markAllAsRead() {
        notifications.forEach(n => n.read = true);
        unreadCount = 0;
        saveNotifications();
        updateBadge();
        renderNotifications();
        showToast('Todas as notificações foram marcadas como lidas', 'success');
    }

    /**
     * Limpa todas as notificações
     */
    async function clearAll() {
        // Verificar se showConfirmModal existe, senão usar fallback
        const confirmFn = typeof window.showConfirmModal === 'function' 
            ? window.showConfirmModal 
            : async (opts) => confirm(opts.message || 'Deseja continuar?');
        
        const confirmed = await confirmFn({
            type: 'danger',
            title: 'Limpar Notificações',
            message: 'Tem certeza que deseja limpar todas as notificações? Esta ação não pode ser desfeita.',
            confirmText: 'Limpar Todas',
            cancelText: 'Cancelar'
        });
        
        if (confirmed) {
            notifications = [];
            unreadCount = 0;
            saveNotifications();
            updateBadge();
            renderNotifications();
            showToast('Todas as notificações foram removidas', 'info');
        }
    }

    /**
     * Alterna filtro
     */
    function setFilter(filter) {
        currentFilter = filter;
        
        // Atualizar tabs
        tabs.forEach(tab => {
            if (tab.getAttribute('data-filter') === filter) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        renderNotifications();
    }

    /**
     * Atualiza o badge de contagem
     */
    function updateBadge() {
        badge = document.querySelector('.notification-dot');
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    /**
     * Abre o painel
     */
    function openPanel() {
        isOpen = true;
        // Remover estilos inline de ocultação
        panel.style.cssText = '';
        overlay.style.cssText = '';
        // Adicionar classe show
        panel.classList.add('show');
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
        renderNotifications();
    }

    /**
     * Fecha o painel
     */
    function closePanel() {
        isOpen = false;
        panel.classList.remove('show');
        overlay.classList.remove('show');
        // Restaurar estilos inline de ocultação
        setTimeout(() => {
            if (!isOpen) {
                panel.style.cssText = 'right: -600px; visibility: hidden; opacity: 0; pointer-events: none; transform: translateX(100%);';
                overlay.style.cssText = 'visibility: hidden; opacity: 0; pointer-events: none;';
            }
        }, 300); // Aguardar animação CSS
        document.body.style.overflow = '';
    }

    /**
     * Alterna o painel
     */
    function togglePanel() {
        if (isOpen) {
            closePanel();
        } else {
            openPanel();
        }
    }

    /**
     * Salva notificações no localStorage
     */
    function saveNotifications() {
        try {
            // Manter apenas as últimas 50 notificações
            const toSave = notifications.slice(0, 50);
            localStorage.setItem('notifications', JSON.stringify(toSave));
            localStorage.setItem('unreadCount', unreadCount.toString());
        } catch (e) {
            console.error('Erro ao salvar notificações:', e);
        }
    }

    /**
     * Carrega notificações do localStorage
     */
    function loadNotifications() {
        try {
            const saved = localStorage.getItem('notifications');
            const savedCount = localStorage.getItem('unreadCount');
            
            if (saved) {
                notifications = JSON.parse(saved);
                
                // Filtrar notificações de demonstração antigas
                const demoTitles = [
                    'Bem-vindo ao ALUFORCE!',
                    'Atualização disponível',
                    'Backup agendado',
                    'Bem-vindo',
                    'Nova atualização'
                ];
                const demoMessages = [
                    'Sistema iniciado com sucesso',
                    'Versão 2.0',
                    'backup automático',
                    'Explore todos os módulos'
                ];
                
                const originalLength = notifications.length;
                notifications = notifications.filter(n => {
                    // Remover por título exato
                    if (demoTitles.includes(n.title)) return false;
                    // Remover por parte da mensagem
                    if (demoMessages.some(msg => n.message && n.message.toLowerCase().includes(msg.toLowerCase()))) return false;
                    return true;
                });
                
                // Se removeu alguma, salvar novamente
                if (notifications.length !== originalLength) {
                    console.log(`🧹 Removidas ${originalLength - notifications.length} notificações de demonstração`);
                    saveNotifications();
                }
            }
            
            if (savedCount) {
                unreadCount = parseInt(savedCount, 10);
            }
            
            // Recalcular contagem de não lidas
            unreadCount = notifications.filter(n => !n.read).length;
            
        } catch (e) {
            console.error('Erro ao carregar notificações:', e);
            notifications = [];
            unreadCount = 0;
        }
        
        // Carregar notificações do servidor também
        loadFromServer();
    }

    /**
     * Carrega notificações do servidor
     */
    async function loadFromServer() {
        try {
            const response = await fetch('/api/notificacoes?limite=20', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.notificacoes) {
                    // Mesclar notificações do servidor com locais (evitar duplicatas)
                    data.notificacoes.forEach(serverNotif => {
                        const exists = notifications.find(n => 
                            n.title === serverNotif.titulo && 
                            n.message === serverNotif.mensagem &&
                            n.time === serverNotif.created_at
                        );
                        
                        if (!exists) {
                            notifications.push({
                                id: serverNotif.id,
                                title: serverNotif.titulo,
                                message: serverNotif.mensagem,
                                type: serverNotif.tipo || 'info',
                                time: serverNotif.created_at,
                                read: serverNotif.lida === 1,
                                modulo: serverNotif.modulo,
                                link: serverNotif.link,
                                fromServer: true
                            });
                        }
                    });
                    
                    // Ordenar por data (mais recentes primeiro)
                    notifications.sort((a, b) => new Date(b.time) - new Date(a.time));
                    
                    // Atualizar contagem
                    unreadCount = notifications.filter(n => !n.read).length;
                    
                    saveNotifications();
                    updateBadge();
                    renderNotifications();
                }
            }
        } catch (e) {
            console.log('Notificações do servidor não disponíveis:', e.message);
        }
    }

    /**
     * Envia notificação para o servidor
     */
    async function sendToServer(notification) {
        try {
            const response = await fetch('/api/notificacoes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    titulo: notification.title,
                    mensagem: notification.message,
                    tipo: notification.type,
                    modulo: notification.modulo || 'sistema',
                    link: notification.link || null,
                    broadcast: notification.broadcast || false
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.id;
            }
        } catch (e) {
            console.log('Erro ao enviar notificação para servidor:', e.message);
        }
        return null;
    }

    /**
     * Carrega alertas reais dos módulos do sistema
     */
    async function loadAlertsFromModules() {
        try {
            const response = await fetch('/api/notificacoes/alertas', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.alertas && data.alertas.length > 0) {
                    // Adicionar alertas como notificações (evitar duplicatas)
                    data.alertas.forEach(alerta => {
                        const alertaKey = `${alerta.modulo}-${alerta.titulo}`;
                        const exists = notifications.find(n => 
                            n.alertaKey === alertaKey
                        );
                        
                        if (!exists) {
                            const newNotif = {
                                id: Date.now() + Math.random(),
                                alertaKey: alertaKey,
                                title: alerta.titulo,
                                message: alerta.mensagem,
                                type: alerta.tipo === 'danger' ? 'error' : alerta.tipo,
                                time: new Date().toISOString(),
                                read: false,
                                modulo: alerta.modulo,
                                link: alerta.link,
                                icone: alerta.icone,
                                fromAlerts: true
                            };
                            notifications.unshift(newNotif);
                            unreadCount++;
                        }
                    });
                    
                    saveNotifications();
                    updateBadge();
                    renderNotifications();
                }
            }
        } catch (e) {
            console.log('Alertas do servidor não disponíveis:', e.message);
        }
    }

    /**
     * Mostra um toast (reutiliza a função global se existir)
     */
    function showToast(message, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Força a sincronização com o servidor
     */
    function syncWithServer() {
        loadFromServer();
    }

    // API Pública
    return {
        init,
        addNotification,
        openPanel,
        closePanel,
        togglePanel,
        markAsRead,
        markAllAsRead,
        clearAll,
        getUnreadCount: () => unreadCount,
        getAll: () => notifications,
        syncWithServer,
        loadAlertsFromModules,
        sendToServer,
        refresh: () => {
            loadFromServer();
            loadAlertsFromModules();
        }
    };
})();

// Inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => NotificationsManager.init());
} else {
    NotificationsManager.init();
}

// Expor globalmente
window.NotificationsManager = NotificationsManager;
