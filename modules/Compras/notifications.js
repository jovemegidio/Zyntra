// ========================================
// SISTEMA DE NOTIFICAÇÕES
// Gerenciamento centralizado de notificações
// ========================================

class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.unreadCount = 0;
        this.types = {
            ESTOQUE_BAIXO: 'estoque_baixo',
            PEDIDO_APROVACAO: 'pedido_aprovacao',
            ENTREGA_ATRASADA: 'entrega_atrasada',
            DIVERGENCIA_RECEBIMENTO: 'divergencia_recebimento',
            COTACAO_VENCENDO: 'cotacao_vencendo',
            ORCAMENTO_ALERTA: 'orcamento_alerta',
            NFE_PENDENTE: 'nfe_pendente',
            FORNECEDOR_AVALIACAO: 'fornecedor_avaliacao'
        };
        this.init();
    }

    init() {
        this.gerarNotificacoesIniciais();
        this.renderizarBadge();
        this.setupEventListeners();
        this.iniciarVerificacaoPeriodica();
    }

    gerarNotificacoesIniciais() {
        // Notificações de estoque baixo
        this.addNotification({
            type: this.types.ESTOQUE_BAIXO,
            title: 'Estoque Baixo',
            message: '15 materiais estão com estoque abaixo do mínimo',
            icon: 'fas fa-box-open',
            color: '#ef4444',
            priority: 'high',
            link: 'materiais-new.html?filter=estoque_baixo',
            time: new Date(Date.now() - 1000 * 60 * 15), // 15 min atrás
            actions: [
                { label: 'Ver Materiais', action: 'viewMaterials' },
                { label: 'Criar Pedido', action: 'createPurchase' }
            ]
        });

        // Pedidos pendentes de aprovação
        this.addNotification({
            type: this.types.PEDIDO_APROVACAO,
            title: 'Pedidos Aguardando Aprovação',
            message: '8 pedidos de compra precisam de sua aprovação',
            icon: 'fas fa-clipboard-check',
            color: '#f59e0b',
            priority: 'high',
            link: 'pedidos-new.html?filter=pendente',
            time: new Date(Date.now() - 1000 * 60 * 30), // 30 min atrás
            actions: [
                { label: 'Revisar Pedidos', action: 'reviewOrders' }
            ]
        });

        // Entregas atrasadas
        this.addNotification({
            type: this.types.ENTREGA_ATRASADA,
            title: 'Entregas Atrasadas',
            message: '5 pedidos estão com entrega atrasada',
            icon: 'fas fa-truck',
            color: '#dc2626',
            priority: 'critical',
            link: 'pedidos-new.html?filter=atrasado',
            time: new Date(Date.now() - 1000 * 60 * 60), // 1h atrás
            actions: [
                { label: 'Ver Pedidos', action: 'viewDelayed' },
                { label: 'Contatar Fornecedor', action: 'contactSupplier' }
            ]
        });

        // Divergências no recebimento
        this.addNotification({
            type: this.types.DIVERGENCIA_RECEBIMENTO,
            title: 'Divergências Identificadas',
            message: '3 recebimentos com divergências precisam de análise',
            icon: 'fas fa-exclamation-triangle',
            color: '#f59e0b',
            priority: 'high',
            link: 'recebimento-new.html?filter=divergencia',
            time: new Date(Date.now() - 1000 * 60 * 45), // 45 min atrás
            actions: [
                { label: 'Analisar Divergências', action: 'analyzeDivergence' }
            ]
        });

        // Cotações vencendo
        this.addNotification({
            type: this.types.COTACAO_VENCENDO,
            title: 'Cotações Vencendo',
            message: '4 cotações vencem nas próximas 24 horas',
            icon: 'fas fa-clock',
            color: '#8b5cf6',
            priority: 'medium',
            link: 'cotacoes-new.html?filter=vencendo',
            time: new Date(Date.now() - 1000 * 60 * 90), // 1.5h atrás
            actions: [
                { label: 'Ver Cotações', action: 'viewQuotes' }
            ]
        });

        // Alerta de orçamento
        this.addNotification({
            type: this.types.ORCAMENTO_ALERTA,
            title: 'Alerta de Orçamento',
            message: 'Orçamento mensal atingiu 85% do limite (R$ 425.000 de R$ 500.000)',
            icon: 'fas fa-chart-line',
            color: '#f59e0b',
            priority: 'medium',
            link: 'relatorios-new.html',
            time: new Date(Date.now() - 1000 * 60 * 120), // 2h atrás
            actions: [
                { label: 'Ver Relatório', action: 'viewReport' }
            ]
        });

        // NF-e pendente
        this.addNotification({
            type: this.types.NFE_PENDENTE,
            title: 'NF-e Pendente de Registro',
            message: '2 notas fiscais aguardando lançamento no sistema',
            icon: 'fas fa-file-invoice',
            color: '#3b82f6',
            priority: 'medium',
            link: 'recebimento-new.html',
            time: new Date(Date.now() - 1000 * 60 * 180), // 3h atrás
            actions: [
                { label: 'Registrar NF-e', action: 'registerInvoice' }
            ]
        });

        // Avaliação de fornecedor
        this.addNotification({
            type: this.types.FORNECEDOR_AVALIACAO,
            title: 'Avaliação de Fornecedor',
            message: 'Alcoa Alumínio S.A. - Avaliar entrega do pedido PC-2024-0156',
            icon: 'fas fa-star',
            color: '#6366f1',
            priority: 'low',
            link: 'fornecedores.html',
            time: new Date(Date.now() - 1000 * 60 * 240), // 4h atrás
            actions: [
                { label: 'Avaliar Agora', action: 'rateSupplier' },
                { label: 'Lembrar Depois', action: 'remindLater' }
            ]
        });

        // Marcar algumas como lidas
        if (this.notifications[6]) this.notifications[6].read = true;
        if (this.notifications[7]) this.notifications[7].read = true;

        this.updateUnreadCount();
    }

    addNotification(notification) {
        const id = this.notifications.length > 0 ? Math.max(...this.notifications.map(n => n.id)) + 1 : 1;
        this.notifications.unshift({
            id: id,
            ...notification,
            read: false,
            createdAt: notification.time || new Date()
        });
        this.updateUnreadCount();
    }

    markAsRead(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (notification && !notification.read) {
            notification.read = true;
            this.updateUnreadCount();
            this.renderizarBadge();
            this.renderizarCentral();
        }
    }

    markAllAsRead() {
        this.notifications.forEach(n => n.read = true);
        this.updateUnreadCount();
        this.renderizarBadge();
        this.renderizarCentral();
    }

    deleteNotification(notificationId) {
        this.notifications = this.notifications.filter(n => n.id !== notificationId);
        this.updateUnreadCount();
        this.renderizarBadge();
        this.renderizarCentral();
    }

    updateUnreadCount() {
        this.unreadCount = this.notifications.filter(n => !n.read).length;
    }

    renderizarBadge() {
        const badge = document.getElementById('notificationCount');
        if (!badge) return;

        if (this.unreadCount > 0) {
            badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    renderizarCentral() {
        const panel = document.getElementById('notificationPanel');
        if (!panel) return;

        const header = panel.querySelector('.notification-header');
        const body = panel.querySelector('.notification-body');

        // Atualizar contador no header
        const countSpan = header.querySelector('.notification-count');
        if (countSpan) {
            countSpan.textContent = this.unreadCount > 0 ? `${this.unreadCount} nova${this.unreadCount > 1 ? 's' : ''}` : 'Nenhuma nova';
        }

        // Renderizar notificações
        body.innerHTML = '';

        if (this.notifications.length === 0) {
            body.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                    <i class="fas fa-bell-slash" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                    <p style="margin: 0; font-size: 16px;">Nenhuma notificação</p>
                </div>
            `;
            return;
        }

        // Agrupar por data
        const hoje = new Date().toDateString();
        const ontem = new Date(Date.now() - 86400000).toDateString();

        const groups = {
            hoje: [],
            ontem: [],
            antigas: []
        };

        this.notifications.forEach(notification => {
            const notifDate = new Date(notification.createdAt).toDateString();
            if (notifDate === hoje) {
                groups.hoje.push(notification);
            } else if (notifDate === ontem) {
                groups.ontem.push(notification);
            } else {
                groups.antigas.push(notification);
            }
        });

        // Renderizar cada grupo
        if (groups.hoje.length > 0) {
            body.insertAdjacentHTML('beforeend', '<div class="notification-group-title">Hoje</div>');
            groups.hoje.forEach(n => this.renderizarNotificacao(body, n));
        }

        if (groups.ontem.length > 0) {
            body.insertAdjacentHTML('beforeend', '<div class="notification-group-title">Ontem</div>');
            groups.ontem.forEach(n => this.renderizarNotificacao(body, n));
        }

        if (groups.antigas.length > 0) {
            body.insertAdjacentHTML('beforeend', '<div class="notification-group-title">Anteriores</div>');
            groups.antigas.forEach(n => this.renderizarNotificacao(body, n));
        }
    }

    renderizarNotificacao(container, notification) {
        const timeAgo = this.getTimeAgo(notification.createdAt);
        
        const div = document.createElement('div');
        div.className = 'notification-item' + (notification.read ? ' read' : '');
        div.innerHTML = `
            <div class="notification-icon" style="background-color: ${notification.color};">
                <i class="${notification.icon}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${notification.title}</div>
                <div class="notification-message">${notification.message}</div>
                ${notification.actions && notification.actions.length > 0 ? `
                    <div class="notification-actions">
                        ${notification.actions.map(action => `
                            <button class="notification-action-btn" onclick="notificationSystem.handleAction('${action.action}', ${notification.id})">
                                ${action.label}
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="notification-time">${timeAgo}</div>
            </div>
            <div class="notification-controls">
                ${!notification.read ? `
                    <button class="notification-control-btn" onclick="notificationSystem.markAsRead(${notification.id})" title="Marcar como lida">
                        <i class="fas fa-check"></i>
                    </button>
                ` : ''}
                <button class="notification-control-btn" onclick="notificationSystem.deleteNotification(${notification.id})" title="Excluir">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        // Adicionar evento de clique
        div.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                this.markAsRead(notification.id);
                if (notification.link) {
                    window.location.href = notification.link;
                }
            }
        });

        container.appendChild(div);
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        
        if (seconds < 60) return 'Agora mesmo';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min atrás`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
        if (seconds < 172800) return 'Ontem';
        return `${Math.floor(seconds / 86400)} dias atrás`;
    }

    handleAction(actionType, notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        
        switch (actionType) {
            case 'viewMaterials':
                window.location.href = 'materiais-new.html?filter=estoque_baixo';
                break;
            case 'createPurchase':
                window.location.href = 'pedidos-new.html?new=true';
                break;
            case 'reviewOrders':
                window.location.href = 'pedidos-new.html?filter=pendente';
                break;
            case 'viewDelayed':
                window.location.href = 'pedidos-new.html?filter=atrasado';
                break;
            case 'contactSupplier':
                alert('Abrindo sistema de comunicação com fornecedor...');
                break;
            case 'analyzeDivergence':
                window.location.href = 'recebimento-new.html?filter=divergencia';
                break;
            case 'viewQuotes':
                window.location.href = 'cotacoes-new.html?filter=vencendo';
                break;
            case 'viewReport':
                window.location.href = 'relatorios-new.html';
                break;
            case 'registerInvoice':
                window.location.href = 'recebimento-new.html?new=true';
                break;
            case 'rateSupplier':
                alert('Abrindo formulário de avaliação de fornecedor...');
                this.markAsRead(notificationId);
                break;
            case 'remindLater':
                this.markAsRead(notificationId);
                setTimeout(() => {
                    this.addNotification({
                        ...notification,
                        time: new Date()
                    });
                    this.renderizarBadge();
                }, 3000);
                alert('Você será lembrado em 24 horas');
                break;
            default:
                console.log('Ação não implementada:', actionType);
        }
    }

    togglePanel() {
        const panel = document.getElementById('notificationPanel');
        if (!panel) return;

        const isVisible = panel.style.display === 'block';
        
        if (isVisible) {
            panel.style.display = 'none';
        } else {
            this.renderizarCentral();
            panel.style.display = 'block';
        }
    }

    setupEventListeners() {
        // Botão de sino
        const bell = document.getElementById('notificationBell');
        if (bell) {
            bell.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePanel();
            });
        }

        // Botão marcar todas como lidas
        const markAllBtn = document.getElementById('markAllRead');
        if (markAllBtn) {
            markAllBtn.addEventListener('click', () => {
                this.markAllAsRead();
            });
        }

        // Fechar ao clicar fora
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('notificationPanel');
            const bell = document.getElementById('notificationBell');
            
            if (panel && bell && 
                !panel.contains(e.target) && 
                !bell.contains(e.target)) {
                panel.style.display = 'none';
            }
        });
    }

    iniciarVerificacaoPeriodica() {
        // Verificar novas notificações a cada 30 segundos
        setInterval(() => {
            this.verificarNovasNotificacoes();
        }, 30000);
    }

    async verificarNovasNotificacoes() {
        // Buscar notificações reais da API
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/compras/dashboard', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const stats = data.dashboard || data || {};

                // Gerar notificações baseadas em dados reais
                const estoqueBaixo = parseInt(stats.materiaisEstoqueBaixo || stats.materiais_estoque_baixo || 0);
                const pedidosPendentes = parseInt(stats.pedidosPendentes || stats.pedidos_pendentes || 0);

                if (estoqueBaixo > 0) {
                    const jaExiste = this.notifications.some(n => n.type === this.types.ESTOQUE_BAIXO && !n.read);
                    if (!jaExiste) {
                        this.addNotification({
                            type: this.types.ESTOQUE_BAIXO,
                            title: 'Alerta de Estoque',
                            message: `${estoqueBaixo} materiais com estoque abaixo do mínimo`,
                            icon: 'fas fa-box-open',
                            color: '#ef4444',
                            priority: 'high'
                        });
                        this.renderizarBadge();
                    }
                }

                if (pedidosPendentes > 0) {
                    const jaExiste = this.notifications.some(n => n.type === this.types.PEDIDO_APROVACAO && !n.read);
                    if (!jaExiste) {
                        this.addNotification({
                            type: this.types.PEDIDO_APROVACAO,
                            title: 'Pedidos Aguardando Aprovação',
                            message: `${pedidosPendentes} pedidos precisam de aprovação`,
                            icon: 'fas fa-clipboard-check',
                            color: '#f59e0b',
                            priority: 'high'
                        });
                        this.renderizarBadge();
                    }
                }
            }
        } catch (error) {
            console.error('Erro ao verificar notificações:', error);
        }
    }

    showToast(title, message) {
        // Criar toast notification
        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        toast.innerHTML = `
            <div style="display: flex; align-items: start; gap: 12px;">
                <i class="fas fa-bell" style="color: #8b5cf6; font-size: 20px; margin-top: 2px;"></i>
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px;">${title}</div>
                    <div style="font-size: 14px; color: var(--text-secondary);">${message}</div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        document.body.appendChild(toast);

        // Animar entrada
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);

        // Remover após 5 segundos
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 5000);
    }

    // Métodos para integração com outros módulos
    notificarEstoqueBaixo(materialCodigo, quantidade) {
        this.addNotification({
            type: this.types.ESTOQUE_BAIXO,
            title: 'Estoque Baixo Detectado',
            message: `${materialCodigo} - Quantidade atual: ${quantidade}`,
            icon: 'fas fa-box-open',
            color: '#ef4444',
            priority: 'high',
            link: 'materiais-new.html'
        });
        this.renderizarBadge();
        this.showToast('Estoque Baixo', `${materialCodigo} precisa de reposição`);
    }

    notificarPedidoAprovacao(pedidoNumero, valor) {
        this.addNotification({
            type: this.types.PEDIDO_APROVACAO,
            title: 'Pedido Aguardando Aprovação',
            message: `${pedidoNumero} - Valor: ${this.formatarMoeda(valor)}`,
            icon: 'fas fa-clipboard-check',
            color: '#f59e0b',
            priority: 'high',
            link: 'pedidos-new.html'
        });
        this.renderizarBadge();
    }

    notificarEntregaAtrasada(pedidoNumero, fornecedor, diasAtraso) {
        this.addNotification({
            type: this.types.ENTREGA_ATRASADA,
            title: 'Entrega Atrasada',
            message: `${pedidoNumero} - ${fornecedor} - ${diasAtraso} dias de atraso`,
            icon: 'fas fa-truck',
            color: '#dc2626',
            priority: 'critical',
            link: 'pedidos-new.html'
        });
        this.renderizarBadge();
        this.showToast('Entrega Atrasada', `${pedidoNumero} está ${diasAtraso} dias atrasado`);
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    }
}

// Inicializar sistema de notificações globalmente
let notificationSystem;

// Adicionar estilos CSS para notificações
const notificationStyles = `
<style>
    .notification-panel {
        position: fixed;
        top: 70px;
        right: 20px;
        width: 420px;
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 100px);
        background: var(--card-bg);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        display: none;
        z-index: 9999;
        overflow: hidden;
        animation: slideInRight 0.3s ease-out;
    }

    @keyframes slideInRight {
        from {
            transform: translateX(20px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    .notification-header {
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .notification-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .notification-count {
        font-size: 14px;
        color: var(--text-secondary);
        font-weight: 500;
    }

    .notification-header-actions {
        display: flex;
        gap: 8px;
    }

    .notification-header-btn {
        padding: 6px 12px;
        border: none;
        background: var(--border-color);
        color: var(--text-primary);
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.3s;
    }

    .notification-header-btn:hover {
        background: var(--primary-color);
        color: white;
    }

    .notification-body {
        max-height: 500px;
        overflow-y: auto;
    }

    .notification-group-title {
        padding: 12px 20px 8px;
        font-size: 12px;
        font-weight: 700;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .notification-item {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        gap: 12px;
        cursor: pointer;
        transition: background 0.3s;
    }

    .notification-item:hover {
        background: var(--hover-bg);
    }

    .notification-item.read {
        opacity: 0.6;
    }

    .notification-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        flex-shrink: 0;
    }

    .notification-icon i {
        font-size: 18px;
    }

    .notification-content {
        flex: 1;
    }

    .notification-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 4px;
    }

    .notification-message {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.4;
        margin-bottom: 8px;
    }

    .notification-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
    }

    .notification-action-btn {
        padding: 6px 12px;
        border: 1px solid var(--border-color);
        background: transparent;
        color: var(--primary-color);
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.3s;
    }

    .notification-action-btn:hover {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
    }

    .notification-time {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .notification-controls {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .notification-control-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: var(--border-color);
        color: var(--text-secondary);
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s;
    }

    .notification-control-btn:hover {
        background: var(--primary-color);
        color: white;
    }

    .notification-toast {
        position: fixed;
        top: 80px;
        right: 20px;
        width: 360px;
        max-width: calc(100vw - 40px);
        background: #ffffff;
        padding: 16px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
        z-index: 10000;
        transform: translateX(400px);
        transition: transform 0.3s ease-out;
        border: 1px solid #e2e8f0;
    }

    .notification-toast.show {
        transform: translateX(0);
    }

    @media (max-width: 768px) {
        .notification-panel {
            width: calc(100vw - 20px);
            right: 10px;
        }
        
        .notification-toast {
            width: calc(100vw - 20px);
            right: 10px;
        }
    }
</style>
`;

// Adicionar HTML do painel de notificações
const notificationPanelHTML = `
<div id="notificationPanel" class="notification-panel">
    <div class="notification-header">
        <div>
            <h3>Notificações</h3>
            <span class="notification-count">0 novas</span>
        </div>
        <div class="notification-header-actions">
            <button class="notification-header-btn" id="markAllRead">
                <i class="fas fa-check-double"></i>
            </button>
        </div>
    </div>
    <div class="notification-body">
        <!-- Notificações serão inseridas aqui -->
    </div>
</div>
`;

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    // Adicionar estilos
    document.head.insertAdjacentHTML('beforeend', notificationStyles);
    
    // Adicionar painel
    document.body.insertAdjacentHTML('beforeend', notificationPanelHTML);
    
    // Inicializar sistema
    notificationSystem = new NotificationSystem();
});
