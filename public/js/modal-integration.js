/**
 * Integração Global de Alterações Não Salvas
 * ALUFORCE v2.0
 *
 * Auto-integra com todos os modais do sistema para verificar alterações não salvas
 * Inclui também notificações em tempo real e exportação PDF/Excel
 */

(function() {
    'use strict';

    // Aguardar DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // Injetar CSS adicional
        injectGlobalStyles();

        // Auto-configurar todos os modais
        setTimeout(() => {
            autoConfigureModals();
            setupFormTracking();
            setupNotificationsRealtime();
        }, 500);

        // Observer para novos modais
        observeNewModals();

        console.log('✅ Integração Global de Modais inicializada');
    }

    function injectGlobalStyles() {
        if (document.getElementById('global-modal-integration-styles')) return;

        const style = document.createElement('style');
        style.id = 'global-modal-integration-styles';
        style.textContent = `
            /* Indicador de alterações não salvas */
            .modal-has-changes::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: linear-gradient(90deg, #f59e0b, #fbbf24);
                animation: pulse-warning 2s infinite;
            }

            @keyframes pulse-warning {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            /* Badge de alterações */
            .unsaved-badge {
                position: absolute;
                top: -8px;
                right: -8px;
                background: #f59e0b;
                color: white;
                font-size: 10px;
                font-weight: 600;
                padding: 2px 6px;
                border-radius: 10px;
                display: none;
            }

            .has-unsaved-changes .unsaved-badge {
                display: block;
            }

            /* Notificação toast para alterações */
            .unsaved-toast {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(100px);
                background: #1f2937;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                z-index: 999998;
                transition: transform 0.3s ease;
            }

            .unsaved-toast.show {
                transform: translateX(-50%) translateY(0);
            }

            .unsaved-toast i {
                color: #fbbf24;
            }

            /* Botões de ação rápida */
            .quick-export-btn {
                position: fixed;
                bottom: 80px;
                right: 20px;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
                transition: all 0.3s ease;
                z-index: 9999;
            }

            .quick-export-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
            }

            .quick-export-menu {
                position: fixed;
                bottom: 140px;
                right: 20px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                padding: 8px;
                display: none;
                z-index: 9999;
            }

            .quick-export-menu.show {
                display: block;
            }

            .quick-export-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
                border: none;
                background: transparent;
                width: 100%;
                text-align: left;
                font-size: 14px;
                color: #374151;
            }

            .quick-export-item:hover {
                background: #f3f4f6;
            }

            .quick-export-item i {
                width: 20px;
                text-align: center;
            }

            .quick-export-item.pdf i { color: #ef4444; }
            .quick-export-item.excel i { color: #10b981; }
            .quick-export-item.csv i { color: #3b82f6; }
        `;
        document.head.appendChild(style);
    }

    function autoConfigureModals() {
        // Encontrar todos os modais
        const modals = document.querySelectorAll('[class*="modal"]:not([id*="confirm"]):not([id*="popup"]):not([id*="toast"])');

        modals.forEach(modal => {
            if (modal.querySelector('form') && !modal.dataset.unsavedConfigured) {
                configureModal(modal);
                modal.dataset.unsavedConfigured = 'true';
            }
        });

        // Também interceptar botões de fechar comuns
        const closeButtons = document.querySelectorAll(
            '[onclick*="fecharModal"], [onclick*="closeModal"], [onclick*="close()"], ' +
            '.modal-close, .btn-close, [data-dismiss="modal"], [data-bs-dismiss="modal"]'
        );

        closeButtons.forEach(btn => {
            if (!btn.dataset.unsavedConfigured) {
                wrapCloseButton(btn);
                btn.dataset.unsavedConfigured = 'true';
            }
        });
    }

    function configureModal(modal) {
        const form = modal.querySelector('form');
        if (!form) return;

        // Rastrear alterações
        if (typeof window.rastrearAlteracoesFormulario === 'function') {
            window.rastrearAlteracoesFormulario(form);
        }

        // Marcar modal visualmente quando houver alterações
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                checkAndMarkModal(modal, form);
            });
        });
    }

    function checkAndMarkModal(modal, form) {
        if (typeof window.formularioTemAlteracoes === 'function') {
            if (window.formularioTemAlteracoes(form)) {
                modal.classList.add('modal-has-changes');
                showUnsavedToast();
            } else {
                modal.classList.remove('modal-has-changes');
            }
        }
    }

    let toastTimeout;
    function showUnsavedToast() {
        let toast = document.getElementById('unsaved-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'unsaved-toast';
            toast.className = 'unsaved-toast';
            toast.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Você tem alterações não salvas';
            document.body.appendChild(toast);
        }

        clearTimeout(toastTimeout);
        toast.classList.add('show');

        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function wrapCloseButton(btn) {
        const originalOnclick = btn.getAttribute('onclick');

        btn.removeAttribute('onclick');
        btn.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();

            // Encontrar modal pai
            const modal = btn.closest('[class*="modal"]');
            const form = modal ? modal.querySelector('form') : null;

            // Verificar alterações
            if (form && typeof window.formularioTemAlteracoes === 'function' && window.formularioTemAlteracoes(form)) {
                const changes = typeof window.obterAlteracoesFormulario === 'function'
                    ? window.obterAlteracoesFormulario(form)
                    : [];

                if (typeof window.confirmarDescartarAlteracoes === 'function') {
                    const descartar = await window.confirmarDescartarAlteracoes({
                        changes: changes.map(f => `Campo "${f}" foi modificado`)
                    });

                    if (!descartar) return;

                    // Limpar rastreamento
                    if (typeof window.limparAlteracoesFormulario === 'function') {
                        window.limparAlteracoesFormulario(form);
                    }
                }
            }

            // Executar onclick original (sem usar eval — CSP-compliant)
            if (originalOnclick) {
                try {
                    // Extrair nome da função e argumentos
                    const matchWithArgs = originalOnclick.match(/^(\w+)\(([^)]*)\)$/);
                    const matchSimple = originalOnclick.match(/^(\w+)\(\)$/);
                    
                    if (matchSimple && typeof window[matchSimple[1]] === 'function') {
                        // Função sem argumentos: fecharModal()
                        window[matchSimple[1]]();
                    } else if (matchWithArgs && typeof window[matchWithArgs[1]] === 'function') {
                        // Função com argumentos: fecharModal('nome-modal')
                        // Parsear argumentos de forma segura
                        var argsStr = matchWithArgs[2].trim();
                        var args = [];
                        if (argsStr) {
                            // Separar por vírgula respeitando strings
                            var parts = argsStr.match(/(?:'[^']*'|"[^"]*"|\d+(?:\.\d+)?|true|false|null|undefined)/g);
                            if (parts) {
                                args = parts.map(function(arg) {
                                    arg = arg.trim();
                                    if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
                                        return arg.slice(1, -1);
                                    }
                                    if (arg === 'true') return true;
                                    if (arg === 'false') return false;
                                    if (arg === 'null') return null;
                                    if (arg === 'undefined') return undefined;
                                    var num = Number(arg);
                                    return isNaN(num) ? arg : num;
                                });
                            }
                        }
                        window[matchWithArgs[1]].apply(window, args);
                    } else {
                        // Fallback: re-atribuir como onclick e simular clique
                        var tmpBtn = document.createElement('button');
                        tmpBtn.setAttribute('onclick', originalOnclick);
                        tmpBtn.style.display = 'none';
                        document.body.appendChild(tmpBtn);
                        tmpBtn.click();
                        document.body.removeChild(tmpBtn);
                    }
                } catch (err) {
                    console.error('Erro ao executar onclick:', err);
                }
            }
        });
    }

    function setupFormTracking() {
        // Rastrear todos os formulários
        const forms = document.querySelectorAll('form:not([data-no-track])');
        forms.forEach(form => {
            if (!form.dataset.tracked && typeof window.rastrearAlteracoesFormulario === 'function') {
                window.rastrearAlteracoesFormulario(form);
                form.dataset.tracked = 'true';
            }
        });
    }

    function observeNewModals() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if (node.classList && Array.from(node.classList).some(c => c.includes('modal'))) {
                            setTimeout(() => configureModal(node), 100);
                        }
                        // Checar filhos
                        const modals = node.querySelectorAll ? node.querySelectorAll('[class*="modal"]') : [];
                        modals.forEach(m => setTimeout(() => configureModal(m), 100));
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ========================================
    // NOTIFICAÇÕES EM TEMPO REAL
    // ========================================
    function setupNotificationsRealtime() {
        // Verificar se Socket.io está disponível
        if (typeof io === 'undefined') {
            // Tentar carregar
            loadSocketIO();
            return;
        }

        connectToNotifications();
    }

    function loadSocketIO() {
        // Tentar conectar ao servidor de socket
        const script = document.createElement('script');
        script.src = '/socket.io/socket.io.js';
        script.onload = () => connectToNotifications();
        script.onerror = () => console.log('Socket.io não disponível - notificações em tempo real desativadas');
        document.head.appendChild(script);
    }

    let notificationSocket = null;
    function connectToNotifications() {
        try {
            if (typeof io === 'undefined') return;

            // Usar socket compartilhado se já existir
            if (window._aluforceSocket && window._aluforceSocket.connected) {
                notificationSocket = window._aluforceSocket;
                console.log('📢 Usando socket compartilhado existente');
                setupNotificationListeners();
                return;
            }

            notificationSocket = io({
                path: '/socket.io',
                transports: ['websocket'],  // Forçar WebSocket apenas
                upgrade: false,  // Não fazer upgrade
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 2000,
                reconnectionDelayMax: 10000,
                timeout: 30000,
                forceNew: false,
                autoConnect: true
            });

            // Compartilhar globalmente
            window._aluforceSocket = notificationSocket;

            notificationSocket.on('connect', () => {
                console.log('📢 Conectado ao sistema de notificações em tempo real');

                // Identificar usuário
                const token = localStorage.getItem('token');
                if (token) {
                    notificationSocket.emit('authenticate', { token });
                }
            });

            notificationSocket.on('disconnect', (reason) => {
                // Silenciar desconexões esperadas (transport close, ping timeout)
                if (reason === 'io server disconnect') {
                    console.log('📢 Socket desconectado pelo servidor');
                }
            });

            notificationSocket.on('connect_error', (error) => {
                // Silenciar erros de websocket - reconexão automática já está configurada
            });

            setupNotificationListeners();

        } catch (e) {
            console.error('Erro ao conectar notificações:', e);
        }
    }

    function setupNotificationListeners() {
        if (!notificationSocket) return;

        try {
            notificationSocket.on('notification', (data) => {
                showRealtimeNotification(data);
            });

            notificationSocket.on('conta_vencendo', (data) => {
                showRealtimeNotification({
                    type: 'warning',
                    title: 'Conta Vencendo!',
                    message: `${data.descricao} - R$ ${data.valor?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    icon: 'fa-exclamation-triangle'
                });
            });

            notificationSocket.on('pedido_novo', (data) => {
                showRealtimeNotification({
                    type: 'success',
                    title: 'Novo Pedido!',
                    message: `Pedido #${data.numero} - ${data.cliente}`,
                    icon: 'fa-shopping-cart'
                });
            });

            notificationSocket.on('disconnect', (reason) => {
                // Silenciar logs de desconexão esperada
                if (reason !== 'io server disconnect') {
                    // Reconectar silenciosamente
                }
            });

            // Silenciar erros de conexão no console
            notificationSocket.on('connect_error', () => {
                // Reconexão automática já está configurada
            });

            notificationSocket.on('error', () => {
                // Erro silenciado - reconexão automática
            });
        } catch (err) {
            // Silenciar erros de socket
        }
    }

    function showRealtimeNotification(data) {
        // Usar sistema de notificação existente se disponível
        if (typeof window.showNotification === 'function') {
            window.showNotification(data);
            return;
        }

        // Criar notificação nativa
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(data.title, {
                body: data.message,
                icon: '/favicon.ico'
            });
        }

        // Também mostrar toast na tela
        const toast = document.createElement('div');
        toast.className = 'realtime-notification-toast';
        toast.innerHTML = `
            <div class="rtn-icon ${data.type || 'info'}">
                <i class="fas ${data.icon || 'fa-bell'}"></i>
            </div>
            <div class="rtn-content">
                <strong>${data.title}</strong>
                <p>${data.message}</p>
            </div>
            <button class="rtn-close">&times;</button>
        `;

        // Adicionar estilos se não existirem
        if (!document.getElementById('realtime-notification-styles')) {
            const style = document.createElement('style');
            style.id = 'realtime-notification-styles';
            style.textContent = `
                .realtime-notification-toast {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    padding: 16px;
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    max-width: 360px;
                    z-index: 999999;
                    animation: slideInRight 0.3s ease;
                }
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .rtn-icon {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .rtn-icon.success { background: #dcfce7; color: #22c55e; }
                .rtn-icon.warning { background: #fef3c7; color: #f59e0b; }
                .rtn-icon.error { background: #fee2e2; color: #ef4444; }
                .rtn-icon.info { background: #dbeafe; color: #3b82f6; }
                .rtn-content { flex: 1; }
                .rtn-content strong { display: block; margin-bottom: 4px; color: #1f2937; }
                .rtn-content p { margin: 0; font-size: 13px; color: #6b7280; }
                .rtn-close {
                    background: none;
                    border: none;
                    font-size: 20px;
                    color: #9ca3af;
                    cursor: pointer;
                    line-height: 1;
                }
                .rtn-close:hover { color: #6b7280; }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        toast.querySelector('.rtn-close').addEventListener('click', () => {
            toast.remove();
        });

        // Auto-remover após 5s
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideInRight 0.3s ease reverse';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
    }

    // ========================================
    // EXPORTAÇÍO RÁPIDA PDF/EXCEL
    // ========================================
    window.setupQuickExport = function() {
        if (document.getElementById('quick-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'quick-export-btn';
        btn.className = 'quick-export-btn';
        btn.innerHTML = '<i class="fas fa-file-export"></i>';
        btn.title = 'Exportar dados';

        const menu = document.createElement('div');
        menu.id = 'quick-export-menu';
        menu.className = 'quick-export-menu';
        menu.innerHTML = `
            <button class="quick-export-item pdf" data-format="pdf">
                <i class="fas fa-file-pdf"></i> Exportar PDF
            </button>
            <button class="quick-export-item excel" data-format="excel">
                <i class="fas fa-file-excel"></i> Exportar Excel
            </button>
            <button class="quick-export-item csv" data-format="csv">
                <i class="fas fa-file-csv"></i> Exportar CSV
            </button>
        `;

        document.body.appendChild(btn);
        document.body.appendChild(menu);

        btn.addEventListener('click', () => {
            menu.classList.toggle('show');
        });

        menu.querySelectorAll('.quick-export-item').forEach(item => {
            item.addEventListener('click', () => {
                const format = item.dataset.format;
                exportCurrentView(format);
                menu.classList.remove('show');
            });
        });

        // Fechar ao clicar fora
        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
            }
        });
    };

    async function exportCurrentView(format) {
        // Encontrar tabela ou dados na página
        const table = document.querySelector('table:not([class*="hidden"])');
        const pageTitle = document.querySelector('h1, .page-title, .header-title')?.textContent || 'Relatório';

        if (!table) {
            if (typeof window.showNotification === 'function') {
                window.showNotification({
                    type: 'warning',
                    title: 'Nenhum dado para exportar',
                    message: 'Não foi encontrada nenhuma tabela de dados nesta página.'
                });
            } else {
                alert('Nenhum dado para exportar nesta página.');
            }
            return;
        }

        showRealtimeNotification({
            type: 'info',
            title: 'Exportando...',
            message: `Preparando arquivo ${format.toUpperCase()}`,
            icon: 'fa-spinner fa-spin'
        });

        try {
            if (format === 'pdf') {
                await exportToPDF(table, pageTitle);
            } else if (format === 'excel') {
                await exportToExcel(table, pageTitle);
            } else if (format === 'csv') {
                exportToCSV(table, pageTitle);
            }
        } catch (err) {
            console.error('Erro na exportação:', err);
            showRealtimeNotification({
                type: 'error',
                title: 'Erro na exportação',
                message: err.message
            });
        }
    }

    async function exportToPDF(table, title) {
        // Usar jsPDF se disponível
        if (typeof jsPDF === 'undefined') {
            // Carregar biblioteca
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text(title, 14, 22);
        doc.setFontSize(10);
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);

        doc.autoTable({
            html: table,
            startY: 35,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [26, 26, 46] }
        });

        doc.save(`${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);

        showRealtimeNotification({
            type: 'success',
            title: 'PDF Exportado!',
            message: 'O arquivo foi baixado com sucesso.',
            icon: 'fa-check'
        });
    }

    async function exportToExcel(table, title) {
        // Usar SheetJS se disponível
        if (typeof XLSX === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.table_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, ws, 'Dados');
        XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_${Date.now()}.xlsx`);

        showRealtimeNotification({
            type: 'success',
            title: 'Excel Exportado!',
            message: 'O arquivo foi baixado com sucesso.',
            icon: 'fa-check'
        });
    }

    function exportToCSV(table, title) {
        const rows = table.querySelectorAll('tr');
        let csv = '';

        rows.forEach(row => {
            const cells = row.querySelectorAll('td, th');
            const rowData = Array.from(cells).map(cell => {
                let text = cell.textContent.trim();
                // Escapar aspas
                text = text.replace(/"/g, '""');
                // Envolver em aspas se tiver vírgula
                if (text.includes(',') || text.includes('')) {
                    text = `"${text}"`;
                }
                return text;
            });
            csv += rowData.join(',') + '';
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${title.replace(/\s+/g, '_')}_${Date.now()}.csv`;
        link.click();

        showRealtimeNotification({
            type: 'success',
            title: 'CSV Exportado!',
            message: 'O arquivo foi baixado com sucesso.',
            icon: 'fa-check'
        });
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Solicitar permissão para notificações
    if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => {
            Notification.requestPermission();
        }, 5000);
    }
})();
