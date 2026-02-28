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
        
        document.body.appendChild(panel);
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
                position: fixed;
                top: 60px;
                right: 20px;
                width: 380px;
                max-height: 500px;
                background: white;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.15);
                z-index: 10000;
                display: none;
                flex-direction: column;
                overflow: hidden;
                animation: slideDown 0.2s ease;
            }
            
            .notification-panel-global.active {
                display: flex;
            }
            
            @keyframes slideDown {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .notif-panel-header {
                padding: 16px 20px;
                background: linear-gradient(135deg, #f97316, #ea580c);
                color: white;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .notif-panel-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .notif-panel-actions {
                display: flex;
                gap: 8px;
            }
            
            .notif-panel-actions button {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 8px;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .notif-panel-actions button:hover {
                background: rgba(255,255,255,0.3);
            }
            
            .notif-panel-tabs {
                display: flex;
                padding: 12px 16px;
                gap: 8px;
                background: #f8fafc;
                border-bottom: 1px solid #e2e8f0;
            }
            
            .notif-tab {
                padding: 6px 14px;
                border: none;
                background: transparent;
                color: #64748b;
                font-size: 13px;
                font-weight: 500;
                border-radius: 20px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .notif-tab:hover {
                background: #e2e8f0;
            }
            
            .notif-tab.active {
                background: #f97316;
                color: white;
            }
            
            .notif-panel-list {
                flex: 1;
                overflow-y: auto;
                max-height: 320px;
            }
            
            .notif-loading {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 40px;
                color: #94a3b8;
                gap: 10px;
            }
            
            .notif-item {
                display: flex;
                gap: 12px;
                padding: 14px 16px;
                border-bottom: 1px solid #f1f5f9;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .notif-item:hover {
                background: #f8fafc;
            }
            
            .notif-item.unread {
                background: #fffbeb;
                border-left: 3px solid #f97316;
            }
            
            .notif-item-icon {
                width: 36px;
                height: 36px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            
            .notif-item-icon.success { background: #dcfce7; color: #16a34a; }
            .notif-item-icon.warning { background: #fef3c7; color: #d97706; }
            .notif-item-icon.error { background: #fee2e2; color: #dc2626; }
            .notif-item-icon.info { background: #dbeafe; color: #2563eb; }
            .notif-item-icon.order { background: #f3e8ff; color: #7c3aed; }
            
            .notif-item-content {
                flex: 1;
                min-width: 0;
            }
            
            .notif-item-title {
                font-weight: 600;
                font-size: 13px;
                color: #1e293b;
                margin-bottom: 4px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }
            
            .notif-item-time {
                font-size: 11px;
                color: #94a3b8;
                white-space: nowrap;
                margin-left: 8px;
            }
            
            .notif-item-message {
                font-size: 12px;
                color: #64748b;
                line-height: 1.4;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }
            
            .notif-item-badge {
                display: inline-block;
                padding: 2px 6px;
                background: #dc2626;
                color: white;
                font-size: 9px;
                border-radius: 4px;
                margin-top: 6px;
            }
            
            .notif-empty {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px;
                color: #94a3b8;
            }
            
            .notif-empty i {
                font-size: 40px;
                margin-bottom: 12px;
            }
            
            .notif-panel-footer {
                padding: 12px 16px;
                background: #f8fafc;
                border-top: 1px solid #e2e8f0;
                text-align: center;
            }
            
            .notif-panel-footer a {
                color: #f97316;
                text-decoration: none;
                font-size: 13px;
                font-weight: 500;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            
            .notif-panel-footer a:hover {
                text-decoration: underline;
            }
            
            .notification-dot {
                position: absolute;
                top: -2px;
                right: -2px;
                min-width: 18px;
                height: 18px;
                background: #dc2626;
                color: white;
                font-size: 10px;
                font-weight: 600;
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
    
    // Carregar notificações da API
    loadNotifications: async function() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/notifications', {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.notifications = data.notifications || [];
                this.updateBadge(data.unreadCount || 0);
                this.renderNotifications();
            } else {
                console.warn('[NotificationManager] Erro ao carregar notificações');
                this.renderEmpty();
            }
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
            
            return `
                <div class="notif-item ${notif.read ? '' : 'unread'}" onclick="NotificationManager.handleClick(${notif.id})">
                    <div class="notif-item-icon ${notif.type || 'info'}">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="notif-item-content">
                        <div class="notif-item-title">
                            <span>${notif.title || 'Notificação'}</span>
                            <span class="notif-item-time">${time}</span>
                        </div>
                        <div class="notif-item-message">${notif.message || ''}</div>
                        ${notif.important ? '<span class="notif-item-badge"><i class="fas fa-star"></i> Importante</span>' : ''}
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
    
    // Filtrar notificações
    filterNotifications: function(filter) {
        this.renderNotifications(filter);
    },
    
    // Manipular clique em notificação
    handleClick: async function(id) {
        const notif = this.notifications.find(n => n.id === id);
        if (!notif) return;
        
        // Marcar como lida
        if (!notif.read) {
            await this.markAsRead(id);
        }
        
        // Se tiver ação/link, executar
        if (notif.data && notif.data.url) {
            window.location.href = notif.data.url;
        } else if (notif.data && notif.data.pedido_id) {
            // Navegar para o módulo de Vendas com o pedido
            window.location.href = '/Vendas/?pedido=' + notif.data.pedido_id;
        }
        
        this.closePanel();
    },
    
    // Marcar como lida
    markAsRead: async function(id) {
        try {
            const token = localStorage.getItem('token');
            await fetch(`/api/notifications/${id}/read`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            const notif = this.notifications.find(n => n.id === id);
            if (notif) notif.read = true;
            
            this.updateBadge(this.notifications.filter(n => !n.read).length);
            this.renderNotifications();
        } catch (error) {
            console.error('[NotificationManager] Erro ao marcar como lida:', error);
        }
    },
    
    // Marcar todas como lidas
    markAllRead: async function() {
        try {
            const token = localStorage.getItem('token');
            await fetch('/api/notifications/read-all', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include'
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
            // Deletar uma por uma ou implementar rota de delete-all
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
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
            ">
                <div class="modal-content" style="
                    background: white;
                    border-radius: 16px;
                    width: 90%;
                    max-width: 800px;
                    max-height: 85vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                ">
                    <div class="modal-header" style="
                        padding: 20px 24px;
                        border-bottom: 1px solid #e2e8f0;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: linear-gradient(135deg, #f97316, #ea580c);
                        border-radius: 16px 16px 0 0;
                        color: white;
                    ">
                        <h2 style="margin: 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-history"></i>
                            Histórico de Notificações
                        </h2>
                        <button onclick="document.getElementById('modal-historico-notificacoes').remove()" style="
                            background: rgba(255,255,255,0.2);
                            border: none;
                            color: white;
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
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: #94a3b8;">
                                <i class="fas fa-bell-slash" style="font-size: 48px; margin-bottom: 16px;"></i>
                                <p style="margin: 0; font-size: 16px;">Nenhuma notificação no histórico</p>
                            </div>
                        ` : this.notifications.map(notif => `
                            <div style="
                                display: flex;
                                gap: 16px;
                                padding: 16px 24px;
                                border-bottom: 1px solid #f1f5f9;
                            ">
                                <div style="
                                    width: 40px;
                                    height: 40px;
                                    border-radius: 10px;
                                    background: #f1f5f9;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    flex-shrink: 0;
                                ">
                                    <i class="fas ${this.getIcon(notif.type)}" style="color: #64748b;"></i>
                                </div>
                                <div style="flex: 1;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="font-weight: 600; color: #1e293b; font-size: 14px;">
                                            ${notif.title || 'Notificação'}
                                        </span>
                                        <span style="font-size: 11px; color: #94a3b8;">
                                            ${this.formatTime(notif.createdAt)}
                                        </span>
                                    </div>
                                    <p style="margin: 0; font-size: 13px; color: #64748b;">
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
                    // Criar nova conexão com configurações otimizadas
                    const socket = io({
                        path: '/socket.io',
                        transports: ['websocket'],  // Forçar WebSocket apenas
                        upgrade: false,  // Não fazer upgrade de polling para websocket
                        reconnection: true,
                        reconnectionAttempts: 3,  // Reduzir tentativas
                        reconnectionDelay: 2000,
                        reconnectionDelayMax: 10000,
                        timeout: 30000,
                        forceNew: false,
                        autoConnect: true
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
