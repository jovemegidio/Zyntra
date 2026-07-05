/**
 * NotificationManager Global - Sistema de Notificações ALUFORCE
 * Gerencia notificações em tempo real com dropdown e histórico
 */

// Evitar declaração duplicada
if (typeof NotificationManager === 'undefined') {

var NotificationManager = {
    notifications: [],
    isOpen: false,
    container: null,
    panelId: 'global-notification-panel',
    enabled: true,
    soundEnabled: false,
    notificationSound: null,

    withBasePath: function(path) {
        return window.__withBasePath ? window.__withBasePath(path) : path;
    },

    // Habilitar/Desabilitar notificações
    setEnabled: function(enabled) {
        this.enabled = enabled;
        console.log('[NotificationManager] Notificações:', enabled ? 'ATIVADAS' : 'DESATIVADAS');

        // Esconder ou mostrar o badge
        const badge = document.querySelector('.notification-badge');
        if (badge) {
            badge.style.display = enabled ? '' : 'none';
        }
    },

    // Habilitar/Desabilitar som
    setSoundEnabled: function(enabled) {
        this.soundEnabled = enabled;
        console.log('[NotificationManager] Som:', enabled ? 'ATIVADO' : 'DESATIVADO');
    },

    // Tocar som de notificação
    playSound: function() {
        if (!this.soundEnabled) return;

        try {
            // Usar Web Audio API para gerar beep (evita 404 de arquivo mp3)
            this.playBeep();
        } catch(e) {
            console.log('[NotificationManager] Erro ao tocar som:', e);
        }
    },

    // Gerar beep com Web Audio API
    playBeep: function() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

            // Criar oscilador
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            // Configurar som agradável
            oscillator.frequency.value = 880; // Nota A5
            oscillator.type = 'sine';

            // Volume e fade out
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

            // Tocar por 0.3 segundos
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.3);

            console.log('[NotificationManager] 🔔 Beep tocado');
        } catch(e) {
            console.log('[NotificationManager] Web Audio não disponível:', e);
        }
    },

    // Inicializar o sistema
    init: function() {
        console.log('[NotificationManager] Inicializando...');
        this.createPanel();
        this.loadNotifications();
        this.setupEventListeners();
        this.setupSocketIO();
        console.log('[NotificationManager] ✅ Inicializado com sucesso');
    },

    // Criar o painel de notificações
    createPanel: function() {
        // Verificar se já existe
        if (document.getElementById(this.panelId)) {
            this.container = document.getElementById(this.panelId);
            return;
        }

        const panel = document.createElement('div');
        panel.id = this.panelId;
        panel.className = 'notification-panel-global';
        panel.innerHTML = `
            <div class="notif-panel-header">
                <h3><i class="fas fa-bell"></i> Notificações</h3>
                <div class="notif-panel-actions">
                    <button onclick="NotificationManager.markAllRead()" title="Marcar todas como lidas">
                        <i class="fas fa-check-double"></i>
                    </button>
                    <button onclick="NotificationManager.clearAll()" title="Limpar todas">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
            <div class="notif-panel-tabs">
                <button class="notif-tab active" data-filter="todas">Todas</button>
                <button class="notif-tab" data-filter="nao-lidas">Não lidas</button>
                <button class="notif-tab" data-filter="importantes">Importantes</button>
            </div>
            <div class="notif-panel-list" id="notif-panel-list">
                <div class="notif-loading">
                    <i class="fas fa-spinner fa-spin"></i> Carregando...
                </div>
            </div>
            <div class="notif-panel-footer">
                <a href="#" onclick="NotificationManager.openHistory(); return false;">
                    <i class="fas fa-history"></i> Ver histórico completo
                </a>
            </div>
        `;

        // Inserir no wrapper do botão de notificações (ou body como fallback)
        const wrapper = document.querySelector('.header-notifications-wrapper') || document.body;
        wrapper.appendChild(panel);
        this.container = panel;

        // Adicionar estilos
        this.injectStyles();

        // Configurar tabs
        panel.querySelectorAll('.notif-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                panel.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.filterNotifications(e.target.dataset.filter);
            });
        });
    },

    // Injetar estilos CSS
    injectStyles: function() {
        if (document.getElementById('notification-manager-styles')) return;

        const style = document.createElement('style');
        style.id = 'notification-manager-styles';
        style.textContent = `
            .notification-panel-global {
                position: absolute;
                right: -8px;
                top: 52px;
                width: 400px;
                max-width: 92vw;
                max-height: 520px;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 12px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04);
                z-index: 9999;
                display: none;
                flex-direction: column;
                overflow: hidden;
                animation: notifSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .notification-panel-global.active {
                display: flex;
            }

            @keyframes notifSlideIn {
                from { opacity: 0; transform: translateY(-8px) scale(0.97); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }

            .notif-panel-header {
                padding: 14px 18px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: linear-gradient(135deg, #1e40af, #3b82f6);
                color: #fff;
            }

            .notif-panel-header h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
                color: #fff;
            }
            
            .notif-panel-header h3 i {
                color: rgba(255,255,255,0.85);
            }

            .notif-panel-actions {
                display: flex;
                gap: 6px;
            }

            .notif-panel-actions button {
                background: rgba(255, 255, 255, 0.18);
                border: none;
                color: rgba(255, 255, 255, 0.85);
                width: 32px;
                height: 32px;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
                transition: all 0.15s ease;
                -webkit-backdrop-filter: blur(4px);
                backdrop-filter: blur(4px);
            }

            .notif-panel-actions button:hover {
                background: rgba(255, 255, 255, 0.32);
                color: #fff;
                transform: scale(1.08);
            }

            .notif-panel-actions button:active {
                transform: scale(0.95);
            }

            .notif-panel-tabs {
                display: flex;
                padding: 8px 12px;
                gap: 4px;
                border-bottom: 1px solid #f1f5f9;
                background: #fafbfc;
            }

            .notif-tab {
                flex: 1;
                padding: 8px 12px;
                border: none;
                background: transparent;
                color: #94a3b8;
                font-size: 12px;
                font-weight: 500;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .notif-tab:hover {
                background: #f1f5f9;
                color: #475569;
            }

            .notif-tab.active {
                background: rgba(59, 130, 246, 0.1);
                color: #2563eb;
                font-weight: 600;
            }

            .notif-panel-list {
                flex: 1;
                overflow-y: auto;
                max-height: 360px;
                padding: 8px;
                scrollbar-width: thin;
                scrollbar-color: rgba(0,0,0,0.1) transparent;
            }
            .notif-panel-list::-webkit-scrollbar {
                width: 5px;
            }
            .notif-panel-list::-webkit-scrollbar-thumb {
                background: rgba(0,0,0,0.1);
                border-radius: 3px;
            }

            .notif-item {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 10px;
                cursor: pointer;
                transition: all 0.15s ease;
                margin-bottom: 2px;
            }
            .notif-item:hover {
                background: #f8fafc;
                transform: translateX(4px);
            }
            .notif-item.unread {
                background: #f0f7ff;
                border-left: 3px solid #3b82f6;
            }

            .notif-item-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border-radius: 10px;
                flex-shrink: 0;
            }
            .notif-item-icon i {
                font-size: 14px;
            }
            .notif-item-icon.info {
                background: rgba(59, 130, 246, 0.1);
                color: #3b82f6;
            }
            .notif-item-icon.success {
                background: rgba(16, 185, 129, 0.1);
                color: #10b981;
            }
            .notif-item-icon.warning {
                background: rgba(245, 158, 11, 0.1);
                color: #f59e0b;
            }
            .notif-item-icon.error, .notif-item-icon.danger {
                background: rgba(239, 68, 68, 0.1);
                color: #ef4444;
            }
            .notif-item-icon.order {
                background: rgba(59, 130, 246, 0.1);
                color: #3b82f6;
            }
            .notif-item-icon.payment {
                background: rgba(16, 185, 129, 0.1);
                color: #10b981;
            }
            .notif-item-icon.stock {
                background: rgba(139, 92, 246, 0.1);
                color: #8b5cf6;
            }

            .notif-item-content {
                flex: 1;
                min-width: 0;
            }
            .notif-item-title {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 8px;
            }
            .notif-item-title > span:first-child {
                font-size: 13px;
                font-weight: 500;
                color: #1e293b;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .notif-item-time {
                font-size: 11px;
                color: #94a3b8;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .notif-item-message {
                font-size: 12px;
                color: #64748b;
                margin-top: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .notif-item-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin-top: 4px;
                padding: 2px 8px;
                background: rgba(59, 130, 246, 0.08);
                color: #3b82f6;
                border-radius: 10px;
                font-size: 10px;
                font-weight: 600;
            }

            .notif-empty {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 40px 16px;
                color: #94a3b8;
                text-align: center;
            }
            .notif-empty i {
                font-size: 28px;
                opacity: 0.5;
            }
            .notif-empty span {
                font-size: 13px;
            }

            .notif-loading {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                padding: 32px 16px;
                color: #64748b;
                font-size: 14px;
            }

            .notif-panel-footer {
                padding: 12px 16px;
                border-top: 1px solid #f1f5f9;
                text-align: center;
                background: #fafbfc;
            }
            .notif-panel-footer a {
                color: #3b82f6;
                text-decoration: none;
                font-size: 12px;
                font-weight: 500;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: color 0.15s;
            }
            .notif-panel-footer a:hover {
                color: #1d4ed8;
            }

            /* Badge (ponto) no ícone do sino */
            .notification-dot {
                position: absolute;
                top: -2px;
                right: -2px;
                min-width: 18px;
                height: 18px;
                background: #ef4444;
                color: white;
                font-size: 10px;
                font-weight: 700;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 4px;
            }

            .notification-dot:empty,
            .notification-dot[data-count="0"] {
                display: none;
            }
        `;
        document.head.appendChild(style);
    },

    // Carregar notificações da API (DB-backed)
    loadNotifications: async function() {
        try {
            // 1. Carregar notificações persistidas do banco
            const response = await fetch('/api/notificacoes?limite=20', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                const serverNotifs = (data.data || data.notificacoes || []).map(n => ({
                    id: n.id,
                    type: n.tipo || 'info',
                    title: n.titulo || n.title || 'Notificação',
                    message: n.mensagem || n.message || '',
                    read: n.lida === 1 || n.lida === true,
                    important: n.tipo === 'erro' || n.tipo === 'danger' || n.prioridade === 1,
                    createdAt: n.created_at || n.criado_em || new Date().toISOString(),
                    data: { url: n.link },
                    modulo: n.modulo || 'sistema',
                    fromServer: true
                }));
                this.notifications = serverNotifs;
            } else {
                console.warn('[NotificationManager] API /api/notificacoes retornou', response.status);
                this.notifications = [];
            }

            // 2. Carregar alertas em tempo real dos módulos (contas vencidas, pedidos pendentes)
            try {
                const alertasRes = await fetch('/api/notificacoes/alertas', {
                    credentials: 'include'
                });
                if (alertasRes.ok) {
                    const alertasData = await alertasRes.json();
                    if (alertasData.success && alertasData.alertas && alertasData.alertas.length > 0) {
                        alertasData.alertas.forEach(alerta => {
                            // Usar titulo como chave para evitar duplicados
                            if (!this.notifications.find(n => n.title === alerta.titulo)) {
                                this.notifications.unshift({
                                    id: 'alerta_' + alerta.modulo + '_' + alerta.titulo.length,
                                    type: alerta.tipo === 'danger' ? 'error' : (alerta.tipo || 'warning'),
                                    title: alerta.titulo,
                                    message: alerta.mensagem,
                                    read: false,
                                    important: true,
                                    createdAt: new Date().toISOString(),
                                    data: { url: alerta.link },
                                    modulo: alerta.modulo || 'sistema',
                                    isAlerta: true
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.log('[NotificationManager] Alertas não disponíveis:', e.message);
            }

            this.updateBadge(this.notifications.filter(n => !n.read).length);
            this.renderNotifications();
        } catch (error) {
            console.error('[NotificationManager] Erro:', error);
            this.renderEmpty();
        }
    },

    // Renderizar lista de notificações
    renderNotifications: function(filter = 'todas') {
        const list = document.getElementById('notif-panel-list');
        if (!list) return;

        let filtered = [...this.notifications];

        if (filter === 'nao-lidas') {
            filtered = filtered.filter(n => !n.read);
        } else if (filter === 'importantes') {
            filtered = filtered.filter(n => n.important);
        }

        if (filtered.length === 0) {
            list.innerHTML = `
                <div class="notif-empty">
                    <i class="fas fa-bell-slash"></i>
                    <span>Nenhuma notificação</span>
                </div>
            `;
            return;
        }

        list.innerHTML = filtered.slice(0, 20).map(notif => {
            const icon = this.getIcon(notif.type);
            const time = this.formatTime(notif.createdAt);
            const safeId = typeof notif.id === 'string' ? `'${notif.id}'` : notif.id;

            return `
                <div class="notif-item ${notif.read ? '' : 'unread'}" onclick="NotificationManager.handleClick(${safeId})">
                    <div class="notif-item-icon ${notif.type || 'info'}">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="notif-item-content">
                        <div class="notif-item-title">
                            <span>${this.escapeHtml(notif.title || 'Notificação')}</span>
                            <span class="notif-item-time">${time}</span>
                        </div>
                        <div class="notif-item-message">${this.escapeHtml(notif.message || '')}</div>
                        ${notif.modulo ? `<span class="notif-item-badge"><i class="fas fa-tag"></i> ${this.escapeHtml(this.capitalizeFirst(notif.modulo))}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderEmpty: function() {
        const list = document.getElementById('notif-panel-list');
        if (list) {
            list.innerHTML = `
                <div class="notif-empty">
                    <i class="fas fa-bell-slash"></i>
                    <span>Nenhuma notificação</span>
                </div>
            `;
        }
    },

    // Obter ícone por tipo
    getIcon: function(type) {
        const icons = {
            'success': 'fa-check-circle',
            'warning': 'fa-exclamation-triangle',
            'error': 'fa-times-circle',
            'info': 'fa-info-circle',
            'order': 'fa-shopping-cart',
            'payment': 'fa-dollar-sign',
            'stock': 'fa-boxes'
        };
        return icons[type] || 'fa-bell';
    },

    // Formatar tempo
    formatTime: function(date) {
        if (!date) return '';

        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 1) return 'Agora';
        if (mins < 60) return `${mins} min`;
        if (hours < 24) return `${hours}h`;
        if (days < 7) return `${days}d`;
        return d.toLocaleDateString('pt-BR');
    },

    // Escapar HTML para prevenir XSS
    escapeHtml: function(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // Capitalizar primeira letra
    capitalizeFirst: function(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    },

    // Toggle do painel
    togglePanel: function() {
        if (!this.container) {
            this.createPanel();
            this.loadNotifications();
        }

        this.isOpen = !this.isOpen;
        this.container.classList.toggle('active', this.isOpen);

        if (this.isOpen) {
            this.loadNotifications();
        }
    },

    // Fechar painel
    closePanel: function() {
        this.isOpen = false;
        if (this.container) {
            this.container.classList.remove('active');
        }
    },

    // Alias para compatibilidade (toggle = togglePanel)
    toggle: function() {
        return this.togglePanel();
    },

    // Filtrar notificações
    filterNotifications: function(filter) {
        this.renderNotifications(filter);
    },

    // Manipular clique em notificação
    handleClick: async function(id) {
        // IDs podem ser numéricos (DB) ou string (alertas)
        const notif = this.notifications.find(n => String(n.id) === String(id));
        if (!notif) return;

        // Marcar como lida
        if (!notif.read) {
            await this.markAsRead(notif.id);
        }

        // Se tiver ação/link, executar
        if (notif.data && notif.data.url) {
            window.location.href = this.withBasePath(notif.data.url);
        } else if (notif.data && notif.data.pedido_id) {
            window.location.href = this.withBasePath('/Vendas/?pedido=' + notif.data.pedido_id);
        }

        this.closePanel();
    },

    // Marcar como lida
    markAsRead: async function(id) {
        try {
            // Se for alerta dinâmico (não do banco), só marcar localmente
            const notif = this.notifications.find(n => n.id === id);
            if (notif) {
                notif.read = true;
                // Persistir no banco se for notificação real (id numérico)
                if (typeof id === 'number' && id > 0) {
                    fetch(`/api/notificacoes/${id}/lida`, {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' }
                    }).catch(() => {});
                }
            }

            this.updateBadge(this.notifications.filter(n => !n.read).length);
            this.renderNotifications();
        } catch (error) {
            console.error('[NotificationManager] Erro ao marcar como lida:', error);
        }
    },

    // Marcar todas como lidas
    markAllRead: async function() {
        try {
            await fetch('/api/notificacoes/marcar-todas-lidas', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            this.notifications.forEach(n => n.read = true);
            this.updateBadge(0);
            this.renderNotifications();

            this.showToast('Todas as notificações foram marcadas como lidas', 'success');
        } catch (error) {
            console.error('[NotificationManager] Erro ao marcar todas como lidas:', error);
        }
    },

    // Limpar todas
    clearAll: async function() {
        if (!confirm('Deseja limpar todas as notificações?')) return;

        try {
            await fetch('/api/notificacoes/limpar?dias=0', {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }).catch(() => {});

            this.notifications = [];
            this.updateBadge(0);
            this.renderNotifications();

            this.showToast('Notificações limpas', 'info');
        } catch (error) {
            console.error('[NotificationManager] Erro ao limpar:', error);
        }
    },

    // Atualizar badge de contagem
    updateBadge: function(count) {
        const badges = document.querySelectorAll('.notification-dot, .notification-badge, #notification-count');
        badges.forEach(badge => {
            badge.textContent = count > 99 ? '99+' : count;
            badge.dataset.count = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        });
    },

    // Abrir histórico completo
    openHistory: function() {
        this.closePanel();

        // Criar modal de histórico
        const modalHtml = `
            <div id="modal-historico-notificacoes" class="modal-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                -webkit-backdrop-filter: blur(8px);
                backdrop-filter: blur(8px);
            ">
                <div class="modal-content" style="
                    background: rgba(20, 24, 35, 0.98);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 800px;
                    max-height: 85vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.08);
                ">
                    <div class="modal-header" style="
                        padding: 20px 24px;
                        border-bottom: 1px solid rgba(255,255,255,0.08);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: rgba(255,255,255,0.02);
                        border-radius: 16px 16px 0 0;
                    ">
                        <h2 style="margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9);">
                            <i class="fas fa-history" style="color: #f59e0b;"></i>
                            Histórico de Notificações
                        </h2>
                        <button onclick="document.getElementById('modal-historico-notificacoes').remove()" style="
                            background: rgba(255,255,255,0.06);
                            border: 1px solid rgba(255,255,255,0.06);
                            color: rgba(255,255,255,0.6);
                            width: 36px;
                            height: 36px;
                            border-radius: 8px;
                            cursor: pointer;
                            font-size: 18px;
                        ">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" id="historico-lista" style="
                        flex: 1;
                        overflow-y: auto;
                        padding: 0;
                    ">
                        ${this.notifications.length === 0 ? `
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: rgba(255,255,255,0.4);">
                                <i class="fas fa-bell-slash" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                                <p style="margin: 0; font-size: 16px;">Nenhuma notificação no histórico</p>
                            </div>
                        ` : this.notifications.map(notif => `
                            <div style="
                                display: flex;
                                gap: 16px;
                                padding: 16px 24px;
                                border-bottom: 1px solid rgba(255,255,255,0.05);
                            ">
                                <div style="
                                    width: 40px;
                                    height: 40px;
                                    border-radius: 10px;
                                    background: rgba(255,255,255,0.06);
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    flex-shrink: 0;
                                ">
                                    <i class="fas ${this.getIcon(notif.type)}" style="color: rgba(255,255,255,0.5);"></i>
                                </div>
                                <div style="flex: 1;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="font-weight: 500; color: #fff; font-size: 14px;">
                                            ${notif.title || 'Notificação'}
                                        </span>
                                        <span style="font-size: 11px; color: rgba(255,255,255,0.35);">
                                            ${this.formatTime(notif.createdAt)}
                                        </span>
                                    </div>
                                    <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.5);">
                                        ${notif.message || ''}
                                    </p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    // Adicionar nova notificação (local)
    addNotification: function(notification) {
        // Se notificações desativadas, não processar
        if (!this.enabled) {
            console.log('[NotificationManager] Notificação ignorada (desativado)');
            return;
        }

        const newNotif = {
            id: Date.now(),
            type: notification.type || 'info',
            title: notification.title || 'Notificação',
            message: notification.message || '',
            read: false,
            important: notification.important || false,
            createdAt: new Date().toISOString(),
            data: notification.data || {}
        };

        this.notifications.unshift(newNotif);
        this.updateBadge(this.notifications.filter(n => !n.read).length);
        this.renderNotifications();

        // Tocar som se habilitado
        this.playSound();

        // Mostrar toast
        this.showToast(newNotif.title, newNotif.type);
    },

    // Mostrar toast
    showToast: function(message, type = 'info') {
        // Verificar se existe função global
        if (typeof showNotification === 'function') {
            showNotification(message, type);
            return;
        }

        // Fallback simples
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10002;
            animation: slideIn 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    // Configurar event listeners
    setupEventListeners: function() {
        // Fechar ao clicar fora
        document.addEventListener('click', (e) => {
            if (this.isOpen && this.container &&
                !this.container.contains(e.target) &&
                !e.target.closest('.notification-btn') &&
                !e.target.closest('#notifications-btn')) {
                this.closePanel();
            }
        });

        // Fechar com ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closePanel();
            }
        });
    },

    // Configurar Socket.IO para notificações em tempo real
    setupSocketIO: function() {
        if (typeof io !== 'undefined') {
            try {
                // Usar socket compartilhado se já existir
                if (window._aluforceSocket && window._aluforceSocket.connected) {
                    this.socket = window._aluforceSocket;
                    console.log('[NotificationManager] ✅ Usando socket compartilhado existente');
                } else {
                    // Criar nova conexão — autenticação via httpOnly cookie (enviado automaticamente pelo browser)
                    const socket = io({
                        path: '/socket.io',
                        transports: ['websocket'],
                        upgrade: false,
                        reconnection: true,
                        reconnectionAttempts: 5,
                        reconnectionDelay: 2000,
                        reconnectionDelayMax: 10000,
                        timeout: 30000,
                        forceNew: false,
                        autoConnect: true,
                        withCredentials: true
                    });

                    // Compartilhar globalmente
                    window._aluforceSocket = socket;
                    this.socket = socket;

                    socket.on('connect', () => {
                        console.log('[NotificationManager] ✅ Socket conectado:', socket.id);
                    });

                    socket.on('disconnect', (reason) => {
                        console.log('[NotificationManager] Socket desconectado:', reason);
                    });

                    socket.on('connect_error', (error) => {
                        console.warn('[NotificationManager] Erro de conexão Socket:', error.message);
                    });
                }

                this.socket.on('notification', (data) => {
                    console.log('[NotificationManager] Nova notificação recebida:', data);
                    this.addNotification(data);
                });

                console.log('[NotificationManager] ✅ Socket.IO configurado');
            } catch (error) {
                console.warn('[NotificationManager] Socket.IO não disponível:', error.message);
            }
        }
    }
};

} // Fim do if (typeof NotificationManager === 'undefined')

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    // Aguardar um pouco para garantir que outros scripts carregaram
    setTimeout(() => {
        if (typeof NotificationManager !== 'undefined' && typeof NotificationManager.init === 'function') {
            NotificationManager.init();
        }
    }, 500);
});

// Expor globalmente
window.NotificationManager = NotificationManager;
