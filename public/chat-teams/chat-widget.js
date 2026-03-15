/* ═══════════════════════════════════════════════════════════
   ZYNTRA CHAT — Widget Corporativo Profissional v2.0
   Full-page chat with: Status, Files, Audio, Emoji, Search
   Auto-injetável em qualquer página do ALUFORCE
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';
    if (window.__chatTeamsLoaded) return;
    window.__chatTeamsLoaded = true;

    // ── Estado ────────────────────────────────────────────
    let socket = null;
    let currentUser = null;
    let channels = [];
    let users = [];
    let onlineUserIds = [];
    let userStatuses = {}; // userId -> 'online'|'almoco'|'reuniao'|'offline'
    let activeView = { type: 'channel', id: null };
    let typingTimeout = null;
    let isOpen = false;
    let unreadCount = 0;
    let searchQuery = '';
    let pendingFile = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let recInterval = null;
    let recStartTime = 0;
    let myStatus = 'online';
    let dmContactIds = [];  // IDs de usuários com conversa existente
    let showAllUsers = false; // Toggle para mostrar todos os usuários

    const STATUS_LABELS = { online: 'Online', almoco: 'Em Almoço', reuniao: 'Em Reunião', offline: 'Offline' };
    const STATUS_ICONS = { online: '🟢', almoco: '🟡', reuniao: '🟠', offline: '⚫' };

    // ── Notificação sonora ────────────────────────────────
    let notifSound = null;
    function playNotifSound() {
        try {
            if (!notifSound) {
                // Gera um beep curto via AudioContext (sem dependência de arquivo externo)
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
                return;
            }
            notifSound.currentTime = 0;
            notifSound.play().catch(() => {});
        } catch(e) { /* AudioContext not available */ }
    }

    // ── Emojis ────────────────────────────────────────────
    const EMOJI_DATA = {
        'Frequentes': ['😀','😂','❤️','👍','🔥','🎉','😎','🙏','💯','✅','👏','😍','🤝','💪','⭐'],
        'Rostos': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','😍','🤩','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','😱','😨','😰','😥','😢','😭','😤','😡','🤬','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
        'Gestos': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','💪','🦾'],
        'Objetos': ['💼','📁','📂','📊','📈','📉','📋','📌','📎','🔗','📝','✏️','🖊️','📅','📆','⏰','🔔','📣','💡','🔑','🔒','🔓','📱','💻','🖥️','🖨️','⌨️','🖱️','📧','📨','📩','📤','📥','📦','🏷️','💰','💳','🧾'],
        'Símbolos': ['✅','❌','⚠️','🚫','❓','❗','💬','💭','🗨️','📢','🔴','🟡','🟢','🔵','⚪','⚫','🟣','🟤','🔶','🔷','▶️','⏸️','⏹️','⏺️','🔄','🔃','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','🔝','🔚','🔛']
    };

    // ── Helpers ───────────────────────────────────────────
    function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
    function initials(name) { return (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
    function getFirstName(name) { return (name || 'Usuário').trim().split(/\s+/)[0]; }
    function fmtTime(iso) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
    function fmtDate(iso) {
        const d = new Date(iso), today = new Date(), y = new Date(today); y.setDate(y.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return 'Hoje';
        if (d.toDateString() === y.toDateString()) return 'Ontem';
        return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    function fmtSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function fileIcon(name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼️';
        if (['pdf'].includes(ext)) return '📄';
        if (['doc','docx'].includes(ext)) return '📝';
        if (['xls','xlsx','csv'].includes(ext)) return '📊';
        if (['mp3','wav','ogg','webm'].includes(ext)) return '🎵';
        if (['mp4','avi','mov'].includes(ext)) return '🎬';
        if (['zip','rar','7z'].includes(ext)) return '📦';
        return '📎';
    }
    function isImageUrl(url) { return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url); }
    function isAudioUrl(url) { return /\.(mp3|wav|ogg|webm)(\?|$)/i.test(url); }

    function getAuthToken() {
        const cookies = document.cookie.split(';');
        for (const c of cookies) { const [key, val] = c.trim().split('='); if (key === 'authToken' || key === 'token') return val; }
        return localStorage.getItem('token') || localStorage.getItem('authToken') || sessionStorage.getItem('token') || null;
    }

    async function apiFetch(url, opts = {}) {
        const token = getAuthToken();
        const headers = { ...(opts.headers || {}) };
        if (!opts.isFormData) headers['Content-Type'] = 'application/json';
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(url, { ...opts, headers, credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    function getUserStatus(userId) {
        if (userId === -1) return 'bot';
        if (userStatuses[userId]) return userStatuses[userId];
        return onlineUserIds.includes(userId) ? 'online' : 'offline';
    }

    // ═══════════════════════════════════════════════════════
    // BUILD DOM
    // ═══════════════════════════════════════════════════════

    function ensureCSSLoaded() {
        // Auto-inject CSS se ainda não estiver presente na página
        if (document.querySelector('link[href*="chat-widget.css"]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/chat-teams/chat-widget.css?v=' + Date.now();
        document.head.appendChild(link);
    }

    function buildWidget() {
        ensureCSSLoaded();

        // FAB
        const fab = document.createElement('button');
        fab.className = 'ct-fab'; fab.id = 'ct-fab'; fab.title = 'Zyntra Chat';
        fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        document.body.appendChild(fab);

        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'ct-backdrop'; backdrop.id = 'ct-backdrop';
        document.body.appendChild(backdrop);

        // Panel
        const panel = document.createElement('div');
        panel.className = 'ct-panel'; panel.id = 'ct-panel';
        panel.innerHTML = `
            <div class="ct-sidebar">
                <div class="ct-sidebar-header">
                    <div class="ct-sidebar-title">
                        <img src="/images/zyntra-branco.png" class="ct-logo" alt="Zyntra" onerror="this.style.display='none'">
                    </div>
                    <button class="ct-btn-close" id="ct-close" title="Fechar">✕</button>
                </div>
                <div class="ct-search-wrap">
                    <input type="text" class="ct-search-input" id="ct-search" placeholder="Buscar pessoa ou canal..." autocomplete="off" />
                </div>
                <div class="ct-sidebar-sections">
                    <div class="ct-section">
                        <div class="ct-section-header"><span>Assistente</span></div>
                        <div id="ct-bot-list"></div>
                    </div>
                    <div class="ct-section">
                        <div class="ct-section-header">
                            <span>Canais</span>
                            <button class="ct-btn-add" id="ct-btn-new-channel" title="Novo canal">+</button>
                        </div>
                        <ul class="ct-nav-list" id="ct-channel-list"></ul>
                    </div>
                    <div class="ct-section">
                        <div class="ct-section-header"><span>Mensagens Diretas</span></div>
                        <div id="ct-dm-list"></div>
                    </div>
                </div>
                <div class="ct-sidebar-footer" id="ct-sidebar-footer"></div>
                <div class="ct-status-dropdown" id="ct-status-dropdown">
                    <button class="ct-status-option" data-status="online"><span class="ct-opt-dot" style="background:var(--ct-green)"></span>Online</button>
                    <button class="ct-status-option" data-status="almoco"><span class="ct-opt-dot" style="background:var(--ct-yellow)"></span>Em Almoço</button>
                    <button class="ct-status-option" data-status="reuniao"><span class="ct-opt-dot" style="background:var(--ct-orange)"></span>Em Reunião</button>
                    <button class="ct-status-option" data-status="offline"><span class="ct-opt-dot" style="background:var(--ct-text-muted)"></span>Aparecer Offline</button>
                </div>
            </div>
            <div class="ct-main">
                <div class="ct-chat-header">
                    <div class="ct-header-left">
                        <div class="ct-header-avatar channel-avatar" id="ct-header-avatar">#</div>
                        <div class="ct-header-info">
                            <h3 id="ct-chat-title">#geral</h3>
                            <p class="ct-header-sub" id="ct-chat-desc">Canal geral da empresa</p>
                        </div>
                    </div>
                    <div class="ct-header-right">
                        <span class="ct-online-badge" id="ct-online-count">0 online</span>
                    </div>
                </div>
                <div class="ct-messages-area" id="ct-messages-area">
                    <div class="ct-messages-list" id="ct-messages"></div>
                </div>
                <div class="ct-typing hidden" id="ct-typing"></div>
                <div class="ct-input-area">
                    <div class="ct-file-preview" id="ct-file-preview">
                        <span class="ct-preview-icon" id="ct-preview-icon">📎</span>
                        <span class="ct-preview-name" id="ct-preview-name"></span>
                        <button class="ct-preview-remove" id="ct-preview-remove" title="Remover">✕</button>
                    </div>
                    <div class="ct-recording-bar" id="ct-recording-bar">
                        <span class="ct-rec-indicator"></span>
                        <span class="ct-rec-timer" id="ct-rec-timer">0:00</span>
                        <div class="ct-rec-waves" id="ct-rec-waves"></div>
                        <button class="ct-rec-cancel" id="ct-rec-cancel">Cancelar</button>
                        <button class="ct-rec-send" id="ct-rec-send">Enviar</button>
                    </div>
                    <div class="ct-input-wrap">
                        <button class="ct-toolbar-btn ct-btn-attach-icon" id="ct-btn-file" title="Enviar arquivo">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
                        </button>
                        <textarea id="ct-input" placeholder="Escreva uma mensagem..." rows="1"></textarea>
                        <button class="ct-toolbar-btn ct-btn-emoji-icon" id="ct-btn-emoji" title="Emoji">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                        </button>
                        <button class="ct-toolbar-btn ct-btn-mic-icon" id="ct-btn-mic" title="Gravar áudio">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        </button>
                        <button class="ct-btn-send" id="ct-btn-send" title="Enviar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        </button>
                    </div>
                    <input type="file" id="ct-file-input" style="display:none" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,.rar" />
                </div>
                <div class="ct-emoji-picker" id="ct-emoji-picker"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // Modal novo canal
        const modal = document.createElement('div');
        modal.className = 'ct-modal-overlay hidden'; modal.id = 'ct-modal';
        modal.innerHTML = `<div class="ct-modal"><h4>Novo Canal</h4>
            <input type="text" id="ct-new-ch-name" placeholder="Nome do canal" />
            <input type="text" id="ct-new-ch-desc" placeholder="Descrição (opcional)" />
            <label class="ct-modal-label">Departamento (privacidade)</label>
            <select id="ct-new-ch-dept" class="ct-modal-select">
                <option value="todos">Todos</option>
                <option value="financeiro">Financeiro</option>
                <option value="comercial">Comercial</option>
                <option value="ti">TI</option>
                <option value="rh">RH</option>
                <option value="pcp">PCP / Produção</option>
                <option value="faturamento">Faturamento</option>
                <option value="compras">Compras</option>
                <option value="consultoria">Consultoria</option>
            </select>
            <label class="ct-modal-check"><input type="checkbox" id="ct-new-ch-admin" /> Somente admins podem enviar</label>
            <div class="ct-modal-actions"><button class="ct-btn-cancel" id="ct-modal-cancel">Cancelar</button><button class="ct-btn-confirm" id="ct-modal-create">Criar</button></div></div>`;
        document.body.appendChild(modal);

        // Image preview overlay
        const imgPreview = document.createElement('div');
        imgPreview.className = 'ct-img-preview-overlay'; imgPreview.id = 'ct-img-overlay';
        imgPreview.innerHTML = `<img id="ct-img-full" src="" alt="Preview" />`;
        document.body.appendChild(imgPreview);

        // Build emoji picker content
        buildEmojiPicker();
        // Build recording wave bars
        const wavesEl = document.getElementById('ct-rec-waves');
        for (let i = 0; i < 40; i++) { const bar = document.createElement('div'); bar.className = 'ct-rec-bar'; bar.style.height = '4px'; wavesEl.appendChild(bar); }

        bindEvents();
    }

    function buildEmojiPicker() {
        const picker = document.getElementById('ct-emoji-picker');
        let html = `<div class="ct-emoji-search"><input type="text" id="ct-emoji-search-input" placeholder="Buscar emoji..." /></div>`;
        html += `<div class="ct-emoji-grid" id="ct-emoji-grid">`;
        for (const [cat, emojis] of Object.entries(EMOJI_DATA)) {
            html += `<div class="ct-emoji-category" style="grid-column:1/-1;padding:6px 4px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--ct-text-muted)">${cat}</div>`;
            for (const em of emojis) { html += `<button data-emoji="${em}">${em}</button>`; }
        }
        html += `</div>`;
        picker.innerHTML = html;
    }

    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    function bindEvents() {
        const $ = id => document.getElementById(id);

        // Toggle
        $('ct-fab').addEventListener('click', togglePanel);
        $('ct-close').addEventListener('click', togglePanel);
        $('ct-backdrop').addEventListener('click', togglePanel);

        // Send
        $('ct-btn-send').addEventListener('click', sendMessage);
        const input = $('ct-input');
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            emitTyping();
        });

        // Search
        $('ct-search').addEventListener('input', e => { searchQuery = e.target.value.trim().toLowerCase(); renderChannelList(); renderDMList(); });

        // File
        $('ct-btn-file').addEventListener('click', () => $('ct-file-input').click());
        $('ct-file-input').addEventListener('change', handleFileSelect);
        $('ct-preview-remove').addEventListener('click', clearPendingFile);

        // Emoji
        $('ct-btn-emoji').addEventListener('click', e => { e.stopPropagation(); toggleEmoji(); });
        $('ct-emoji-grid').addEventListener('click', e => {
            const emoji = e.target.dataset?.emoji;
            if (emoji) { $('ct-input').value += emoji; $('ct-input').focus(); closeEmoji(); }
        });
        $('ct-emoji-search-input').addEventListener('input', filterEmojis);
        document.addEventListener('click', e => { if (!e.target.closest('.ct-emoji-picker') && !e.target.closest('#ct-btn-emoji')) closeEmoji(); });

        // Audio
        $('ct-btn-mic').addEventListener('click', toggleRecording);
        $('ct-rec-cancel').addEventListener('click', cancelRecording);
        $('ct-rec-send').addEventListener('click', sendRecording);

        // Image preview
        $('ct-img-overlay').addEventListener('click', () => $('ct-img-overlay').classList.remove('open'));

        // Modal
        $('ct-btn-new-channel').addEventListener('click', () => { $('ct-modal').classList.remove('hidden'); $('ct-new-ch-name').value = ''; $('ct-new-ch-desc').value = ''; $('ct-new-ch-name').focus(); });
        $('ct-modal-cancel').addEventListener('click', () => $('ct-modal').classList.add('hidden'));
        $('ct-modal').addEventListener('click', e => { if (e.target.id === 'ct-modal') $('ct-modal').classList.add('hidden'); });
        $('ct-modal-create').addEventListener('click', createChannel);
        $('ct-new-ch-name').addEventListener('keydown', e => { if (e.key === 'Enter') createChannel(); });

        // Status dropdown
        document.querySelectorAll('.ct-status-option').forEach(btn => {
            btn.addEventListener('click', () => {
                myStatus = btn.dataset.status;
                updateMyStatus();
                $('ct-status-dropdown').classList.remove('open');
            });
        });
        document.addEventListener('click', e => { if (!e.target.closest('.ct-status-btn') && !e.target.closest('.ct-status-dropdown')) $('ct-status-dropdown').classList.remove('open'); });

        // Paste (clipboard images)
        $('ct-input').addEventListener('paste', handlePaste);
    }

    // ═══════════════════════════════════════════════════════
    // OPEN / CLOSE
    // ═══════════════════════════════════════════════════════

    function togglePanel() {
        const panel = document.getElementById('ct-panel');
        const backdrop = document.getElementById('ct-backdrop');
        if (isOpen) {
            // Closing with animation
            panel.classList.add('closing');
            backdrop.classList.add('closing');
            panel.addEventListener('animationend', function onEnd() {
                panel.removeEventListener('animationend', onEnd);
                panel.classList.remove('open', 'closing');
                backdrop.classList.remove('open', 'closing');
                isOpen = false;
            }, { once: true });
        } else {
            isOpen = true;
            panel.classList.add('open');
            backdrop.classList.add('open');
            if (!socket) initSocket();
            if (!currentUser) loadCurrentUser();
        }
    }

    // ═══════════════════════════════════════════════════════
    // LOAD USER
    // ═══════════════════════════════════════════════════════

    async function loadCurrentUser() {
        try {
            const me = await apiFetch('/api/me');
            const rawName = me.apelido || me.nome || me.name || me.email?.split('@')[0] || 'Usuário';
            currentUser = {
                id: me.id || me.userId,
                displayName: getFirstName(rawName),
                fullName: rawName,
                email: me.email,
                department: me.departamento || me.setor || me.role || 'Geral',
                avatarColor: ['#4F46E5','#0891B2','#059669','#D97706','#DC2626','#7C3AED','#DB2777','#2563EB'][(me.id||0)%8],
                foto: me.foto || me.avatar || null,
                role: me.role
            };
            renderSidebarFooter();
            socket.emit('chat:online', { ...currentUser, status: myStatus });
            await Promise.all([loadChannels(), loadUsers(), loadContacts()]);
            if (channels.length > 0) selectChannel(channels.find(c => c.nome === 'geral') || channels[0]);
            checkUnread();
        } catch (err) { console.error('[CHAT] Erro ao carregar usuário:', err); }
    }

    function renderSidebarFooter() {
        const footer = document.getElementById('ct-sidebar-footer');
        const avatarHtml = currentUser.foto
            ? `<div class="ct-footer-avatar" style="background:${currentUser.avatarColor}"><img src="${currentUser.foto.startsWith('/') ? currentUser.foto : '/avatars/' + currentUser.foto}" onerror="this.parentElement.textContent='${initials(currentUser.displayName)}'" /></div>`
            : `<div class="ct-footer-avatar" style="background:${currentUser.avatarColor}">${initials(currentUser.displayName)}</div>`;
        footer.innerHTML = `
            ${avatarHtml}
            <div class="ct-footer-user-info">
                <span class="ct-user-name">${esc(currentUser.displayName)}</span>
                <span class="ct-user-dept">${esc(currentUser.department)}</span>
            </div>
            <button class="ct-status-btn" id="ct-status-btn">
                <span class="ct-status-indicator ${myStatus}"></span>
                <span>${STATUS_LABELS[myStatus]}</span>
            </button>
        `;
        document.getElementById('ct-status-btn').addEventListener('click', e => {
            e.stopPropagation();
            document.getElementById('ct-status-dropdown').classList.toggle('open');
        });
    }

    function updateMyStatus() {
        if (socket) socket.emit('chat:status', { userId: currentUser.id, status: myStatus });
        renderSidebarFooter();
        renderDMList();
    }

    // ═══════════════════════════════════════════════════════
    // SOCKET.IO
    // ═══════════════════════════════════════════════════════

    function initSocket() {
        const authToken = getAuthToken();
        socket = io('/chat-teams', {
            transports: ['websocket', 'polling'],
            withCredentials: true,
            auth: authToken ? { token: authToken } : {}
        });
        socket.on('connect', () => { console.log('[CHAT] Socket conectado'); if (currentUser) socket.emit('chat:online', { ...currentUser, status: myStatus }); });

        socket.on('connect_error', (error) => {
            console.warn('[CHAT] Erro de conexão Socket:', error.message);
            // Se token expirou, tentar atualizar
            if (error.message === 'Token inválido ou expirado' || error.message === 'Autenticação necessária') {
                const freshToken = getAuthToken();
                if (freshToken) {
                    socket.auth = { token: freshToken };
                }
            }
        });

        socket.on('disconnect', (reason) => {
            console.log('[CHAT] Socket desconectado:', reason);
        });

        socket.on('chat:channel:message', msg => {
            if (activeView.type === 'channel' && activeView.id === msg.channelId) { appendMessage(msg, 'channel'); }
            else if (msg.userId !== currentUser?.id) { playNotifSound(); }
        });
        socket.on('chat:dm:message', msg => {
            // Adicionar remetente aos contatos automaticamente
            const senderId = msg.fromId === currentUser?.id ? msg.toId : msg.fromId;
            if (senderId && senderId !== -1 && !dmContactIds.includes(senderId)) {
                dmContactIds.push(senderId);
                renderDMList();
            }
            if (activeView.type === 'dm') {
                const otherId = activeView.id;
                // FIX: Mostrar apenas msgs do parceiro atual ou echo próprio para o parceiro atual
                if (msg.fromId === otherId || (msg.fromId === currentUser?.id && msg.toId === otherId)) { appendMessage(msg, 'dm'); return; }
            }
            // FIX: Não incrementar não-lidas para echo de mensagem própria
            if (msg.fromId === currentUser?.id) return;
            unreadCount++; updateFabBadge(); playNotifSound();
        });
        socket.on('chat:dm:notification', data => { if (!isOpen || activeView.type !== 'dm' || activeView.id !== data.fromId) { unreadCount++; updateFabBadge(); playNotifSound(); } });
        socket.on('chat:users:online', ids => { onlineUserIds = ids; renderDMList(); document.getElementById('ct-online-count').textContent = `${ids.length} online`; });
        socket.on('chat:users:statuses', statuses => { userStatuses = statuses; renderDMList(); updateChatHeader(); });
        socket.on('chat:user:status', data => { if (data.userId && data.status) { userStatuses[data.userId] = data.status; renderDMList(); updateChatHeader(); } });
        socket.on('chat:channel:created', ch => { if (!channels.find(c => c.id === ch.id)) { channels.push(ch); renderChannelList(); } });

        // Edit/delete events
        socket.on('chat:message:edited', data => {
            const msgEl = document.querySelector(`.ct-message[data-msg-id="${data.msgId}"]`);
            if (msgEl) {
                const contentEl = msgEl.querySelector('.ct-msg-content');
                if (contentEl) contentEl.innerHTML = esc(data.content) + ' <span class="ct-msg-edited">(editado)</span>';
            }
        });
        socket.on('chat:message:deleted', data => {
            const msgEl = document.querySelector(`.ct-message[data-msg-id="${data.msgId}"]`);
            if (msgEl) msgEl.remove();
        });
        // Channel updated (name/settings)
        socket.on('chat:channel:updated', data => {
            const ch = channels.find(c => c.id === data.id);
            if (ch) { Object.assign(ch, data); renderChannelList(); if (activeView.type === 'channel' && activeView.id === data.id) { updateChatHeader(); updateInputState(); } }
        });

        const typingUsers = new Set();
        socket.on('chat:typing:start', data => {
            if (data.user === currentUser?.displayName) return;
            const el = document.getElementById('ct-typing');
            if (data.isBot) { el.classList.remove('hidden'); el.innerHTML = `🤖 BOB I.A. está digitando <span class="ct-bot-dots"><span></span><span></span><span></span></span>`; return; }
            typingUsers.add(data.user); updateTyping(typingUsers);
        });
        socket.on('chat:typing:stop', data => { typingUsers.delete(data.user); updateTyping(typingUsers); });
    }

    function updateTyping(users) {
        const el = document.getElementById('ct-typing');
        if (users.size === 0) { el.classList.add('hidden'); el.textContent = ''; return; }
        el.classList.remove('hidden');
        const names = Array.from(users);
        el.textContent = names.length === 1 ? `${names[0]} está digitando...` : `${names.join(', ')} estão digitando...`;
    }

    function updateFabBadge() {
        const fab = document.getElementById('ct-fab');
        if (unreadCount > 0) { fab.classList.add('has-unread'); fab.setAttribute('data-count', unreadCount > 99 ? '99+' : unreadCount); }
        else fab.classList.remove('has-unread');
    }

    function emitTyping() {
        if (!socket || !currentUser) return;
        const target = activeView.type === 'channel' ? { channelId: activeView.id } : { toId: activeView.id };
        socket.emit('chat:typing:start', { ...target, user: currentUser.displayName });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => socket.emit('chat:typing:stop', { ...target, user: currentUser.displayName }), 2000);
    }

    // ═══════════════════════════════════════════════════════
    // CHANNELS
    // ═══════════════════════════════════════════════════════

    async function loadChannels() {
        try { channels = await apiFetch('/api/chat/canais'); renderChannelList(); } catch (err) { console.error('[CHAT]', err); }
    }

    function renderChannelList() {
        const list = document.getElementById('ct-channel-list');
        if (!list) return;
        // Filter by search and by department (private channels)
        let filtered = searchQuery ? channels.filter(c => c.nome.includes(searchQuery)) : channels;
        // Private channel: user must be admin OR belong to the channel's department
        if (currentUser && !isAdmin()) {
            const myDept = (currentUser.department || '').toLowerCase();
            filtered = filtered.filter(ch => {
                if (!ch.departamento || ch.departamento === 'todos') return true;
                return ch.departamento.toLowerCase() === myDept || ch.nome === 'geral';
            });
        }
        const lockIcon = '<svg class="ct-lock-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        list.innerHTML = filtered.map(ch => {
            const adminBtns = isAdmin() ? `<button class="ct-ch-edit-btn" data-ch-id="${ch.id}" title="Editar canal">✎</button>` : '';
            const lock = ch.somente_admin ? lockIcon : '';
            return `<li data-channel-id="${ch.id}" class="${activeView.type === 'channel' && activeView.id === ch.id ? 'active' : ''}">
                <span class="ct-channel-hash">#</span>
                <span class="ct-nav-name">${esc(ch.nome)}</span>${lock}
                <span class="ct-ch-actions">${adminBtns}</span>
            </li>`;
        }).join('');
        list.querySelectorAll('li').forEach(li => li.addEventListener('click', e => {
            if (e.target.closest('.ct-ch-edit-btn')) return;
            const ch = channels.find(c => c.id == li.dataset.channelId);
            if (ch) selectChannel(ch);
        }));
        // Bind edit channel buttons
        list.querySelectorAll('.ct-ch-edit-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const ch = channels.find(c => c.id == btn.dataset.chId);
                if (ch) showEditChannelModal(ch);
            });
        });
    }

    function selectChannel(channel) {
        if (activeView.type === 'channel' && activeView.id) socket.emit('chat:channel:leave', activeView.id);
        activeView = { type: 'channel', id: channel.id };
        socket.emit('chat:channel:join', channel.id);
        updateChatHeader();
        document.getElementById('ct-input').placeholder = `Mensagem em #${channel.nome}`;
        renderChannelList(); renderDMList();
        loadChannelMessages(channel.id);
        updateInputState();
    }

    async function loadChannelMessages(channelId) {
        try { const msgs = await apiFetch(`/api/chat/canais/${channelId}/mensagens`); renderMessages(msgs, 'channel'); } catch (err) { console.error('[CHAT]', err); }
    }

    async function createChannel() {
        const name = document.getElementById('ct-new-ch-name').value.trim();
        const desc = document.getElementById('ct-new-ch-desc').value.trim();
        const dept = document.getElementById('ct-new-ch-dept')?.value || 'todos';
        const adminOnly = document.getElementById('ct-new-ch-admin')?.checked || false;
        if (!name) return;
        try {
            const data = await apiFetch('/api/chat/canais', { method: 'POST', body: JSON.stringify({ nome: name, descricao: desc, departamento: dept, somente_admin: adminOnly }) });
            document.getElementById('ct-modal').classList.add('hidden');
            await loadChannels();
            const ch = channels.find(c => c.id === data.channel.id);
            if (ch) selectChannel(ch);
        } catch (err) { console.error('[CHAT]', err); }
    }

    function showEditChannelModal(ch) {
        let modal = document.getElementById('ct-edit-ch-modal');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.className = 'ct-modal-overlay'; modal.id = 'ct-edit-ch-modal';
        modal.innerHTML = `<div class="ct-modal">
            <h4>✎ Editar Canal</h4>
            <label class="ct-modal-label">Nome</label>
            <input type="text" id="ct-edit-ch-name" value="${esc(ch.nome)}" />
            <label class="ct-modal-label">Descrição</label>
            <input type="text" id="ct-edit-ch-desc" value="${esc(ch.descricao || '')}" />
            <label class="ct-modal-label">Departamento (privacidade)</label>
            <select id="ct-edit-ch-dept" class="ct-modal-select">
                <option value="todos" ${(!ch.departamento || ch.departamento === 'todos') ? 'selected' : ''}>Todos</option>
                <option value="financeiro" ${ch.departamento === 'financeiro' ? 'selected' : ''}>Financeiro</option>
                <option value="comercial" ${ch.departamento === 'comercial' ? 'selected' : ''}>Comercial</option>
                <option value="ti" ${ch.departamento === 'ti' ? 'selected' : ''}>TI</option>
                <option value="rh" ${ch.departamento === 'rh' ? 'selected' : ''}>RH</option>
                <option value="pcp" ${ch.departamento === 'pcp' ? 'selected' : ''}>PCP / Produção</option>
                <option value="faturamento" ${ch.departamento === 'faturamento' ? 'selected' : ''}>Faturamento</option>
                <option value="compras" ${ch.departamento === 'compras' ? 'selected' : ''}>Compras</option>
                <option value="consultoria" ${ch.departamento === 'consultoria' ? 'selected' : ''}>Consultoria</option>
            </select>
            <label class="ct-modal-check"><input type="checkbox" id="ct-edit-ch-admin" ${ch.somente_admin ? 'checked' : ''} /> Somente admins podem enviar</label>
            <div class="ct-modal-actions">
                <button class="ct-btn-cancel" id="ct-edit-ch-cancel">Cancelar</button>
                <button class="ct-btn-confirm" id="ct-edit-ch-save">Salvar</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.getElementById('ct-edit-ch-cancel').addEventListener('click', () => modal.remove());
        document.getElementById('ct-edit-ch-save').addEventListener('click', async () => {
            const newName = document.getElementById('ct-edit-ch-name').value.trim();
            const newDesc = document.getElementById('ct-edit-ch-desc').value.trim();
            const newDept = document.getElementById('ct-edit-ch-dept').value;
            const newAdminOnly = document.getElementById('ct-edit-ch-admin').checked;
            if (!newName) return;
            try {
                await apiFetch(`/api/chat/canais/${ch.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ nome: newName, descricao: newDesc, departamento: newDept, somente_admin: newAdminOnly })
                });
                modal.remove();
                await loadChannels();
                if (activeView.type === 'channel' && activeView.id === ch.id) updateChatHeader();
            } catch (err) { console.error('[CHAT] Erro ao editar canal:', err); alert('Erro ao salvar alterações do canal.'); }
        });
    }

    // ═══════════════════════════════════════════════════════
    // DIRECT MESSAGES
    // ═══════════════════════════════════════════════════════

    async function loadUsers() {
        try { users = await apiFetch('/api/chat/usuarios'); renderDMList(); } catch (err) { console.error('[CHAT]', err); }
    }

    async function loadContacts() {
        try { dmContactIds = await apiFetch('/api/chat/contatos'); } catch (err) { dmContactIds = []; }
    }

    function renderDMItem(u) {
        const isActive = activeView.type === 'dm' && activeView.id === u.id;
        const status = getUserStatus(u.id);
        const name = u.displayName || getFirstName(u.fullName);
        const avatarInner = u.foto
            ? `<img src="${u.foto.startsWith('/') ? u.foto : '/avatars/' + u.foto}" onerror="this.parentElement.textContent='${initials(name)}'" />`
            : initials(name);
        return `<div class="ct-dm-item ${isActive ? 'active' : ''}" data-user-id="${u.id}">
            <div class="ct-dm-avatar" style="background:${u.avatarColor}">${avatarInner}<span class="ct-status-dot ${status}"></span></div>
            <div class="ct-dm-info"><span class="ct-dm-name">${esc(name)}</span><span class="ct-dm-dept">${esc(u.department || 'Geral')}</span></div>
        </div>`;
    }

    function renderDMList() {
        const list = document.getElementById('ct-dm-list');
        const botList = document.getElementById('ct-bot-list');
        if (!list || !botList) return;

        const bots = users.filter(u => u.isBot);
        const others = users.filter(u => u.id !== currentUser?.id && !u.isBot);

        // Bot
        botList.innerHTML = bots.map(u => {
            const isActive = activeView.type === 'dm' && activeView.id === u.id;
            return `<div class="ct-dm-item ${isActive ? 'active' : ''}" data-user-id="${u.id}">
                <div class="ct-dm-avatar bot-dm-avatar" style="background:linear-gradient(135deg,#a855f7,#6366f1)"><img src="/chat-teams/BobAI.png" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='🤖'" /><span class="ct-status-dot bot"></span></div>
                <div class="ct-dm-info"><span class="ct-dm-name">BOB I.A.</span><span class="ct-dm-dept">Assistente Virtual • TI</span></div>
            </div>`;
        }).join('');

        // Se buscando, mostrar todos que batem com a busca
        if (searchQuery) {
            const filtered = others.filter(u => (u.displayName||'').toLowerCase().includes(searchQuery) || (u.fullName||'').toLowerCase().includes(searchQuery) || (u.department||'').toLowerCase().includes(searchQuery));
            list.innerHTML = filtered.map(u => renderDMItem(u)).join('') || '<div class="ct-dm-empty">Nenhum resultado</div>';
        } else {
            // Mostrar apenas contatos (quem já trocou mensagem) + quem está online
            const contacts = others.filter(u => dmContactIds.includes(u.id));
            const onlineNonContacts = others.filter(u => !dmContactIds.includes(u.id) && onlineUserIds.includes(u.id));
            const restUsers = others.filter(u => !dmContactIds.includes(u.id) && !onlineUserIds.includes(u.id));

            let html = '';

            // Contatos recentes
            if (contacts.length > 0) {
                html += contacts.map(u => renderDMItem(u)).join('');
            }

            // Online (que não são contatos)
            if (onlineNonContacts.length > 0) {
                if (contacts.length > 0) html += '<div class="ct-dm-divider">Online</div>';
                html += onlineNonContacts.map(u => renderDMItem(u)).join('');
            }

            // Botão para ver mais
            if (restUsers.length > 0) {
                if (showAllUsers) {
                    html += '<div class="ct-dm-divider">Todos os Usuários</div>';
                    html += restUsers.map(u => renderDMItem(u)).join('');
                    html += `<div class="ct-dm-toggle" id="ct-toggle-users"><button>▲ Ocultar</button></div>`;
                } else {
                    html += `<div class="ct-dm-toggle" id="ct-toggle-users"><button>＋ Ver todos (${restUsers.length})</button></div>`;
                }
            }

            // Se nenhum contato e ninguém online
            if (!contacts.length && !onlineNonContacts.length && !showAllUsers) {
                html += `<div class="ct-dm-empty">Nenhuma conversa ainda</div>`;
                html += `<div class="ct-dm-toggle" id="ct-toggle-users"><button>＋ Iniciar conversa (${restUsers.length})</button></div>`;
            }

            list.innerHTML = html;
        }

        // Toggle button handler
        const toggleBtn = document.getElementById('ct-toggle-users');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => { showAllUsers = !showAllUsers; renderDMList(); });
        }

        // Click handlers
        [botList, list].forEach(el => el.querySelectorAll('.ct-dm-item').forEach(item => {
            item.addEventListener('click', () => {
                const u = users.find(x => x.id == item.dataset.userId);
                if (u) selectDM(u);
            });
        }));
    }

    function selectDM(user) {
        if (activeView.type === 'channel' && activeView.id) socket.emit('chat:channel:leave', activeView.id);
        activeView = { type: 'dm', id: user.id };
        // Adicionar aos contatos quando iniciar conversa
        if (!user.isBot && !dmContactIds.includes(user.id)) { dmContactIds.push(user.id); }
        updateChatHeader();
        const name = user.displayName || getFirstName(user.fullName);
        document.getElementById('ct-input').placeholder = user.isBot ? 'Descreva seu problema...' : `Mensagem para ${name}`;
        renderChannelList(); renderDMList();
        loadDMMessages(user.id);
        unreadCount = Math.max(0, unreadCount - 1); updateFabBadge();
        updateInputState();
    }

    async function loadDMMessages(otherId) {
        try { const msgs = await apiFetch(`/api/chat/dm/${otherId}`); renderMessages(msgs, 'dm'); } catch (err) { console.error('[CHAT]', err); }
    }

    // ═══════════════════════════════════════════════════════
    // CHAT HEADER (with avatar, name, dept, status)
    // ═══════════════════════════════════════════════════════

    function updateChatHeader() {
        const avatarEl = document.getElementById('ct-header-avatar');
        const titleEl = document.getElementById('ct-chat-title');
        const descEl = document.getElementById('ct-chat-desc');
        const rightEl = document.querySelector('.ct-header-right');

        if (activeView.type === 'channel') {
            const ch = channels.find(c => c.id === activeView.id);
            avatarEl.className = 'ct-header-avatar channel-avatar';
            avatarEl.innerHTML = '#';
            const lockTag = ch?.somente_admin ? ' 🔒' : '';
            titleEl.textContent = `#${ch?.nome || 'geral'}${lockTag}`;
            descEl.textContent = ch?.descricao || '';
            const editBtn = isAdmin() ? `<button class="ct-header-edit-btn" id="ct-header-edit-ch" title="Editar canal">✎</button>` : '';
            rightEl.innerHTML = `${editBtn}<span class="ct-online-badge" id="ct-online-count">${onlineUserIds.length} online</span>`;
            // Bind edit button
            const editEl = document.getElementById('ct-header-edit-ch');
            if (editEl && ch) editEl.addEventListener('click', () => showEditChannelModal(ch));
        } else {
            const user = users.find(u => u.id === activeView.id);
            if (!user) return;
            const status = getUserStatus(user.id);

            if (user.isBot) {
                avatarEl.className = 'ct-header-avatar';
                avatarEl.style.background = 'linear-gradient(135deg,#a855f7,#6366f1)';
                avatarEl.innerHTML = `<img src="/chat-teams/BobAI.png" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='🤖'" />`;
                titleEl.innerHTML = `BOB I.A. <span class="ct-bot-badge">🤖 Assistente</span>`;
                descEl.textContent = 'Suporte automático 24/7 • Departamento TI';
                rightEl.innerHTML = `<span class="ct-status-text bot" style="color:var(--ct-purple);background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.12)">Sempre Online</span>`;
            } else {
                const avatarInner = user.foto
                    ? `<img src="${user.foto.startsWith('/') ? user.foto : '/avatars/' + user.foto}" onerror="this.parentElement.textContent='${initials(user.displayName)}'" />`
                    : initials(user.displayName);
                avatarEl.className = 'ct-header-avatar';
                avatarEl.style.background = user.avatarColor;
                avatarEl.innerHTML = `${avatarInner}<span class="ct-status-dot ${status}"></span>`;
                titleEl.textContent = user.displayName;
                descEl.textContent = user.department || 'Geral';
                rightEl.innerHTML = `<span class="ct-status-text ${status}">${STATUS_ICONS[status] || '⚫'} ${STATUS_LABELS[status] || 'Offline'}</span>`;
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // RENDER MESSAGES
    // ═══════════════════════════════════════════════════════

    function renderMessages(messages, type) {
        const container = document.getElementById('ct-messages');
        if (messages.length === 0) {
            const targetUser = activeView.type === 'dm' ? users.find(u => u.id === activeView.id) : null;
            const isBot = targetUser?.isBot;
            const welcomeIcon = isBot ? '<img src="/chat-teams/BobAI.png" style="width:64px;height:64px;border-radius:50%;object-fit:cover" onerror="this.textContent=\'🤖\'" />' : '👋';
            container.innerHTML = `<div class="ct-welcome"><span class="ct-welcome-icon">${welcomeIcon}</span><h4>${isBot ? 'BOB I.A.' : 'Bem-vindo!'}</h4><p>${isBot ? 'Assistente virtual do TI.<br>Descreva seu problema!' : 'Início da conversa. Diga olá!'}</p></div>`;
            scrollBottom(); return;
        }
        let html = '', lastDate = '';
        messages.forEach(msg => {
            const date = fmtDate(msg.createdAt);
            if (date !== lastDate) { html += `<div class="ct-date-divider">${date}</div>`; lastDate = date; }
            html += renderMsg(msg);
        });
        container.innerHTML = html;
        bindImageClicks();
        bindAudioPlayers();
        bindMsgActions();
        scrollBottom();
    }

    function renderMsg(msg) {
        const name = msg.displayName || 'Desconhecido';
        const color = msg.avatarColor || '#4F46E5';
        const time = fmtTime(msg.createdAt);
        const isBot = msg.isBot || msg.fromId === -1 || name === 'BOB I.A.';
        const botClass = isBot ? ' bot-message' : '';
        const authorCls = isBot ? ' bot-author' : '';
        const badge = isBot ? '<span class="ct-msg-badge">I.A.</span>' : '';

        let content = esc(msg.content || '');
        if (isBot) content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/•/g, '&nbsp;&nbsp;•');

        // Check for file/image/audio attachments
        let attachmentHtml = '';
        if (msg.fileUrl) {
            if (isImageUrl(msg.fileUrl)) {
                attachmentHtml = `<img class="ct-msg-image" src="${msg.fileUrl}" alt="${esc(msg.fileName || 'imagem')}" data-full="${msg.fileUrl}" loading="lazy" />`;
            } else if (isAudioUrl(msg.fileUrl)) {
                attachmentHtml = renderAudioPlayer(msg.fileUrl, msg.fileName);
            } else {
                attachmentHtml = `<a class="ct-msg-file" href="${msg.fileUrl}" target="_blank" download><div class="ct-file-icon">${fileIcon(msg.fileName)}</div><div class="ct-file-info"><span class="ct-file-name">${esc(msg.fileName || 'arquivo')}</span><span class="ct-file-size">${fmtSize(msg.fileSize || 0)}</span></div></a>`;
            }
        }

        // Avatar
        let avatarHtml;
        if (isBot) avatarHtml = `<div class="ct-msg-avatar bot-avatar" style="background:linear-gradient(135deg,#a855f7,#6366f1)"><img src="/chat-teams/BobAI.png" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='🤖'" /></div>`;
        else if (msg.foto) { const url = msg.foto.startsWith('/') ? msg.foto : `/avatars/${msg.foto}`; avatarHtml = `<div class="ct-msg-avatar" style="background:${color}"><img src="${url}" onerror="this.parentElement.textContent='${initials(name)}'" /></div>`; }
        else avatarHtml = `<div class="ct-msg-avatar" style="background:${color}">${initials(name)}</div>`;

        const displayName = isBot ? 'BOB I.A.' : name;
        const isMine = !isBot && (msg.userId === currentUser?.id || msg.fromId === currentUser?.id);
        const editedTag = msg.editado ? '<span class="ct-msg-edited">(editado)</span>' : '';
        const msgType = activeView.type;
        // Context menu for own messages (not bot)
        let ctxBtn = '';
        if (isMine) {
            ctxBtn = `<div class="ct-msg-actions"><button class="ct-msg-action-btn" data-msg-id="${msg.id}" data-msg-type="${msgType}" title="Opções">⋯</button></div>`;
        }
        return `<div class="ct-message${botClass}" data-msg-id="${msg.id}" data-msg-type="${msgType}" data-msg-user="${msg.userId || msg.fromId}">${ctxBtn}${avatarHtml}<div class="ct-msg-body"><div class="ct-msg-header"><span class="ct-msg-author${authorCls}">${esc(displayName)}</span>${badge}<span class="ct-msg-time">${time}</span>${editedTag}</div>${content ? `<div class="ct-msg-content">${content}</div>` : ''}${attachmentHtml}</div></div>`;
    }

    function renderAudioPlayer(url, name) {
        const bars = Array.from({ length: 30 }, () => 4 + Math.random() * 18).map(h => `<div class="ct-wave-bar" style="height:${h}px"></div>`).join('');
        return `<div class="ct-msg-audio" data-audio-url="${url}"><button class="ct-audio-play" data-playing="false">▶</button><div class="ct-audio-wave">${bars}</div><span class="ct-audio-duration">--:--</span></div>`;
    }

    function appendMessage(msg, type) {
        const container = document.getElementById('ct-messages');
        // FIX: Proteção contra mensagens duplicadas
        if (msg.id && container.querySelector(`.ct-message[data-msg-id="${msg.id}"]`)) return;
        const welcome = container.querySelector('.ct-welcome');
        if (welcome) welcome.remove();
        container.insertAdjacentHTML('beforeend', renderMsg(msg));
        bindImageClicks();
        bindAudioPlayers();
        bindMsgActions();
        scrollBottom();
    }

    function scrollBottom() { const area = document.getElementById('ct-messages-area'); if (area) requestAnimationFrame(() => area.scrollTop = area.scrollHeight); }

    function bindImageClicks() {
        document.querySelectorAll('.ct-msg-image').forEach(img => {
            if (img.dataset.bound) return; img.dataset.bound = '1';
            img.addEventListener('click', () => {
                document.getElementById('ct-img-full').src = img.dataset.full || img.src;
                document.getElementById('ct-img-overlay').classList.add('open');
            });
        });
    }

    function bindAudioPlayers() {
        document.querySelectorAll('.ct-msg-audio').forEach(el => {
            if (el.dataset.bound) return; el.dataset.bound = '1';
            const btn = el.querySelector('.ct-audio-play');
            const durEl = el.querySelector('.ct-audio-duration');
            let audio = null;
            btn.addEventListener('click', () => {
                if (!audio) { audio = new Audio(el.dataset.audioUrl); audio.addEventListener('loadedmetadata', () => { durEl.textContent = formatDuration(audio.duration); }); audio.addEventListener('ended', () => { btn.textContent = '▶'; btn.dataset.playing = 'false'; }); }
                if (btn.dataset.playing === 'true') { audio.pause(); btn.textContent = '▶'; btn.dataset.playing = 'false'; }
                else { audio.play(); btn.textContent = '⏸'; btn.dataset.playing = 'true'; }
            });
        });
    }

    function formatDuration(secs) { const m = Math.floor(secs / 60); const s = Math.floor(secs % 60); return `${m}:${s.toString().padStart(2, '0')}`; }

    // ═══════════════════════════════════════════════════════
    // SEND MESSAGE
    // ═══════════════════════════════════════════════════════

    async function sendMessage() {
        const input = document.getElementById('ct-input');
        const content = input.value.trim();

        // Check channel permission
        if (activeView.type === 'channel' && !canSendInChannel()) return;

        // Upload file first if pending
        if (pendingFile) {
            await uploadAndSendFile(content);
            return;
        }

        if (!content || !socket || !currentUser) return;

        if (activeView.type === 'channel') {
            socket.emit('chat:channel:message', { channelId: activeView.id, userId: currentUser.id, content });
        } else {
            socket.emit('chat:dm:message', { fromId: currentUser.id, toId: activeView.id, content });
        }

        input.value = ''; input.style.height = 'auto';
        socket.emit('chat:typing:stop', activeView.type === 'channel' ? { channelId: activeView.id, user: currentUser.displayName } : { toId: activeView.id, user: currentUser.displayName });
    }

    // ═══════════════════════════════════════════════════════
    // FILE UPLOAD
    // ═══════════════════════════════════════════════════════

    function handleFileSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        pendingFile = file;
        document.getElementById('ct-preview-icon').textContent = fileIcon(file.name);
        document.getElementById('ct-preview-name').textContent = `${file.name} (${fmtSize(file.size)})`;
        document.getElementById('ct-file-preview').classList.add('visible');
        document.getElementById('ct-input').focus();
    }

    function handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) {
                    pendingFile = new File([blob], `screenshot-${Date.now()}.png`, { type: blob.type });
                    document.getElementById('ct-preview-icon').textContent = '🖼️';
                    document.getElementById('ct-preview-name').textContent = `Print colado (${fmtSize(blob.size)})`;
                    document.getElementById('ct-file-preview').classList.add('visible');
                }
                break;
            }
        }
    }

    function clearPendingFile() {
        pendingFile = null;
        document.getElementById('ct-file-preview').classList.remove('visible');
        document.getElementById('ct-file-input').value = '';
    }

    async function uploadAndSendFile(textContent) {
        if (!pendingFile || !currentUser) return;
        try {
            const formData = new FormData();
            formData.append('file', pendingFile);
            const token = getAuthToken();
            const res = await fetch('/api/chat/upload', { method: 'POST', body: formData, headers: token ? { 'Authorization': `Bearer ${token}` } : {}, credentials: 'include' });
            if (!res.ok) throw new Error('Upload falhou');
            const data = await res.json();

            const msgData = {
                content: textContent || '',
                fileUrl: data.url,
                fileName: data.originalName || pendingFile.name,
                fileSize: data.size || pendingFile.size,
                fileMime: data.mimetype || pendingFile.type
            };

            if (activeView.type === 'channel') {
                socket.emit('chat:channel:message', { channelId: activeView.id, userId: currentUser.id, ...msgData });
            } else {
                socket.emit('chat:dm:message', { fromId: currentUser.id, toId: activeView.id, ...msgData });
            }

            document.getElementById('ct-input').value = '';
            document.getElementById('ct-input').style.height = 'auto';
            clearPendingFile();
        } catch (err) { console.error('[CHAT] Erro no upload:', err); alert('Erro ao enviar arquivo. Tente novamente.'); }
    }

    // ═══════════════════════════════════════════════════════
    // AUDIO RECORDING
    // ═══════════════════════════════════════════════════════

    function getSupportedAudioMime() {
        const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
        for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
        return '';
    }

    async function toggleRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            cancelRecording();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Seu navegador não suporta gravação de áudio. Use Chrome, Edge ou Firefox.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 } });
            audioChunks = [];
            const mimeType = getSupportedAudioMime();
            const recOptions = mimeType ? { mimeType } : {};
            mediaRecorder = new MediaRecorder(stream, recOptions);
            mediaRecorder.addEventListener('dataavailable', e => { if (e.data.size > 0) audioChunks.push(e.data); });
            mediaRecorder.addEventListener('error', err => { console.error('[CHAT] Erro no gravador:', err); cancelRecording(); });
            mediaRecorder.start(250); // collect data every 250ms for smoother waves
            recStartTime = Date.now();
            document.getElementById('ct-recording-bar').classList.add('visible');
            document.getElementById('ct-btn-mic').classList.add('recording');

            // Timer + wave animation
            recInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
                document.getElementById('ct-rec-timer').textContent = formatDuration(elapsed);
                document.querySelectorAll('#ct-rec-waves .ct-rec-bar').forEach(bar => {
                    bar.style.height = (3 + Math.random() * 18) + 'px';
                });
            }, 150);
        } catch (err) {
            console.error('[CHAT] Erro no microfone:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert('Permissão do microfone negada. Clique no ícone de cadeado na barra de endereço e permita o acesso ao microfone.');
            } else if (err.name === 'NotFoundError') {
                alert('Nenhum microfone encontrado. Conecte um microfone e tente novamente.');
            } else {
                alert('Não foi possível acessar o microfone: ' + (err.message || 'Erro desconhecido'));
            }
        }
    }

    function cancelRecording() {
        if (mediaRecorder) { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); mediaRecorder = null; }
        clearInterval(recInterval);
        audioChunks = [];
        document.getElementById('ct-recording-bar').classList.remove('visible');
        document.getElementById('ct-btn-mic').classList.remove('recording');
    }

    function sendRecording() {
        if (!mediaRecorder) return;
        const recMime = mediaRecorder.mimeType || 'audio/webm';
        mediaRecorder.addEventListener('stop', async () => {
            const blob = new Blob(audioChunks, { type: recMime });
            audioChunks = [];
            clearInterval(recInterval);
            document.getElementById('ct-recording-bar').classList.remove('visible');
            document.getElementById('ct-btn-mic').classList.remove('recording');

            if (blob.size === 0) { console.warn('[CHAT] Áudio vazio, ignorando.'); return; }

            // Determine file extension from MIME type
            const extMap = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
            const ext = extMap[recMime.split(';')[0]] || 'webm';

            try {
                const formData = new FormData();
                formData.append('audio', blob, `audio-${Date.now()}.${ext}`);
                const token = getAuthToken();
                const res = await fetch('/api/chat/upload-audio', { method: 'POST', body: formData, headers: token ? { 'Authorization': `Bearer ${token}` } : {}, credentials: 'include' });
                if (!res.ok) { const errText = await res.text().catch(() => ''); throw new Error(`Upload áudio falhou (${res.status}): ${errText}`); }
                const data = await res.json();

                const msgData = { content: '', fileUrl: data.url, fileName: data.originalName || 'Áudio', fileSize: data.size || blob.size, fileMime: recMime };
                if (activeView.type === 'channel') socket.emit('chat:channel:message', { channelId: activeView.id, userId: currentUser.id, ...msgData });
                else socket.emit('chat:dm:message', { fromId: currentUser.id, toId: activeView.id, ...msgData });
            } catch (err) { console.error('[CHAT] Erro upload áudio:', err); alert('Erro ao enviar áudio. Tente novamente.'); }
        });
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
    }

    // ═══════════════════════════════════════════════════════
    // MESSAGE ACTIONS (Edit / Delete)
    // ═══════════════════════════════════════════════════════

    function bindMsgActions() {
        document.querySelectorAll('.ct-msg-action-btn').forEach(btn => {
            if (btn.dataset.bound) return; btn.dataset.bound = '1';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                closeContextMenu();
                const msgId = parseInt(btn.dataset.msgId);
                const msgType = btn.dataset.msgType;
                const msgEl = btn.closest('.ct-message');
                const contentEl = msgEl?.querySelector('.ct-msg-content');
                const rect = btn.getBoundingClientRect();
                showContextMenu(msgId, msgType, contentEl?.textContent || '', rect);
            });
        });
    }

    function showContextMenu(msgId, msgType, currentText, rect) {
        closeContextMenu();
        const menu = document.createElement('div');
        menu.className = 'ct-context-menu';
        menu.id = 'ct-context-menu';
        const hasText = currentText.trim().length > 0;
        menu.innerHTML = `
            ${hasText ? `<button class="ct-ctx-item" data-action="edit"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>` : ''}
            <button class="ct-ctx-item" data-action="delete-me"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Apagar para mim</button>
            <button class="ct-ctx-item ct-ctx-danger" data-action="delete-all"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Excluir para todos</button>
        `;
        document.body.appendChild(menu);
        // Position
        const panelRect = document.getElementById('ct-panel').getBoundingClientRect();
        menu.style.top = Math.min(rect.bottom + 4, panelRect.bottom - menu.offsetHeight - 8) + 'px';
        menu.style.left = Math.min(rect.left, panelRect.right - menu.offsetWidth - 8) + 'px';

        // Bind actions
        menu.querySelectorAll('.ct-ctx-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                if (action === 'edit') startEditMessage(msgId, msgType, currentText);
                else if (action === 'delete-me') deleteMessage(msgId, msgType, 'me');
                else if (action === 'delete-all') deleteMessage(msgId, msgType, 'all');
                closeContextMenu();
            });
        });

        // Close on outside click
        setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
    }

    function closeContextMenu() {
        const existing = document.getElementById('ct-context-menu');
        if (existing) existing.remove();
    }

    function startEditMessage(msgId, msgType, currentText) {
        const msgEl = document.querySelector(`.ct-message[data-msg-id="${msgId}"]`);
        if (!msgEl) return;
        const contentEl = msgEl.querySelector('.ct-msg-content');
        if (!contentEl) return;
        const originalText = currentText;
        contentEl.innerHTML = `<div class="ct-edit-wrap"><textarea class="ct-edit-input">${esc(originalText)}</textarea><div class="ct-edit-actions"><button class="ct-edit-cancel">Cancelar</button><button class="ct-edit-save">Salvar</button></div></div>`;
        const textarea = contentEl.querySelector('.ct-edit-input');
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';

        contentEl.querySelector('.ct-edit-cancel').addEventListener('click', () => {
            contentEl.textContent = originalText;
        });
        contentEl.querySelector('.ct-edit-save').addEventListener('click', () => {
            const newText = textarea.value.trim();
            if (!newText || newText === originalText) { contentEl.textContent = originalText; return; }
            socket.emit('chat:message:edit', { msgId, msgType, newContent: newText, userId: currentUser.id });
            contentEl.innerHTML = esc(newText) + ' <span class="ct-msg-edited">(editado)</span>';
        });
        textarea.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); contentEl.querySelector('.ct-edit-save').click(); }
            if (e.key === 'Escape') contentEl.querySelector('.ct-edit-cancel').click();
        });
    }

    function deleteMessage(msgId, msgType, scope) {
        if (scope === 'all') {
            socket.emit('chat:message:delete', { msgId, msgType, userId: currentUser.id, scope: 'all' });
        } else {
            // Delete for me — just hide locally
            const msgEl = document.querySelector(`.ct-message[data-msg-id="${msgId}"]`);
            if (msgEl) msgEl.remove();
            socket.emit('chat:message:delete', { msgId, msgType, userId: currentUser.id, scope: 'me' });
        }
    }

    // ═══════════════════════════════════════════════════════
    // CHANNEL MANAGEMENT (edit name, admin-only, private)
    // ═══════════════════════════════════════════════════════

    function isAdmin() {
        return currentUser && (currentUser.role === 'admin' || currentUser.role === 'Admin' || currentUser.role === 'Administrador');
    }

    function canSendInChannel() {
        if (!activeView || activeView.type !== 'channel') return true;
        const ch = channels.find(c => c.id === activeView.id);
        if (!ch) return true;
        if (ch.somente_admin && !isAdmin()) return false;
        return true;
    }

    function updateInputState() {
        const inputArea = document.querySelector('.ct-input-area');
        if (!inputArea) return;
        if (activeView.type === 'channel' && !canSendInChannel()) {
            inputArea.classList.add('ct-disabled');
            document.getElementById('ct-input').placeholder = '🔒 Somente administradores podem enviar mensagens neste canal';
            document.getElementById('ct-input').disabled = true;
        } else {
            inputArea.classList.remove('ct-disabled');
            document.getElementById('ct-input').disabled = false;
        }
    }

    // ═══════════════════════════════════════════════════════
    // EMOJI PICKER
    // ═══════════════════════════════════════════════════════

    function toggleEmoji() { document.getElementById('ct-emoji-picker').classList.toggle('open'); }
    function closeEmoji() { document.getElementById('ct-emoji-picker').classList.remove('open'); }
    function filterEmojis() {
        const query = document.getElementById('ct-emoji-search-input').value.toLowerCase();
        document.querySelectorAll('#ct-emoji-grid button').forEach(btn => {
            btn.style.display = (!query || btn.dataset.emoji?.includes(query)) ? '' : 'none';
        });
    }

    // ═══════════════════════════════════════════════════════
    // UNREAD CHECK
    // ═══════════════════════════════════════════════════════

    async function checkUnread() {
        try { const data = await apiFetch('/api/chat/nao-lidas'); unreadCount = data.naoLidas || 0; updateFabBadge(); } catch (err) {}
    }
    setInterval(() => { if (!isOpen) checkUnread(); }, 30000);

    // ═══════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════

    function init() {
        if (!getAuthToken()) { setTimeout(init, 2000); return; }
        buildWidget();
        setTimeout(checkUnread, 3000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
