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

    const STATUS_LABELS = { online: 'Online', almoco: 'Em Almoço', reuniao: 'Em Reunião', offline: 'Offline' };
    const STATUS_ICONS = { online: '🟢', almoco: '🟡', reuniao: '🟠', offline: '⚫' };

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
        return localStorage.getItem('authToken') || null;
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

    function buildWidget() {
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
                        <span>Zyntra</span>
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
                        <button class="ct-toolbar-btn" id="ct-btn-file" title="Enviar arquivo">📎</button>
                        <textarea id="ct-input" placeholder="Escreva uma mensagem..." rows="1"></textarea>
                        <button class="ct-toolbar-btn" id="ct-btn-emoji" title="Emoji">😊</button>
                        <button class="ct-toolbar-btn" id="ct-btn-mic" title="Gravar áudio">🎤</button>
                        <button class="ct-btn-send" id="ct-btn-send" title="Enviar">
                            <svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
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
        modal.innerHTML = `<div class="ct-modal"><h4>Novo Canal</h4><input type="text" id="ct-new-ch-name" placeholder="Nome do canal" /><input type="text" id="ct-new-ch-desc" placeholder="Descrição (opcional)" /><div class="ct-modal-actions"><button class="ct-btn-cancel" id="ct-modal-cancel">Cancelar</button><button class="ct-btn-confirm" id="ct-modal-create">Criar</button></div></div>`;
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
        isOpen = !isOpen;
        document.getElementById('ct-panel').classList.toggle('open', isOpen);
        document.getElementById('ct-backdrop').classList.toggle('open', isOpen);
        if (isOpen) {
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
            currentUser = {
                id: me.id || me.userId,
                displayName: me.apelido || me.nome || me.name || me.email?.split('@')[0] || 'Usuário',
                email: me.email,
                department: me.departamento || me.setor || me.role || 'Geral',
                avatarColor: ['#4F46E5','#0891B2','#059669','#D97706','#DC2626','#7C3AED','#DB2777','#2563EB'][(me.id||0)%8],
                foto: me.foto || me.avatar || null,
                role: me.role
            };
            renderSidebarFooter();
            socket.emit('chat:online', { ...currentUser, status: myStatus });
            await Promise.all([loadChannels(), loadUsers()]);
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
        socket = io('/chat-teams', { transports: ['websocket', 'polling'], withCredentials: true });
        socket.on('connect', () => { console.log('[CHAT] Socket conectado'); if (currentUser) socket.emit('chat:online', { ...currentUser, status: myStatus }); });

        socket.on('chat:channel:message', msg => { if (activeView.type === 'channel' && activeView.id === msg.channelId) appendMessage(msg, 'channel'); });
        socket.on('chat:dm:message', msg => {
            if (activeView.type === 'dm') {
                const otherId = activeView.id;
                if (msg.fromId === otherId || msg.fromId === currentUser?.id || msg.toId === currentUser?.id) { appendMessage(msg, 'dm'); return; }
            }
            unreadCount++; updateFabBadge();
        });
        socket.on('chat:dm:notification', data => { if (!isOpen || activeView.type !== 'dm' || activeView.id !== data.fromId) { unreadCount++; updateFabBadge(); } });
        socket.on('chat:users:online', ids => { onlineUserIds = ids; renderDMList(); document.getElementById('ct-online-count').textContent = `${ids.length} online`; });
        socket.on('chat:users:statuses', statuses => { userStatuses = statuses; renderDMList(); updateChatHeader(); });
        socket.on('chat:user:status', data => { if (data.userId && data.status) { userStatuses[data.userId] = data.status; renderDMList(); updateChatHeader(); } });
        socket.on('chat:channel:created', ch => { if (!channels.find(c => c.id === ch.id)) { channels.push(ch); renderChannelList(); } });

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
        const filtered = searchQuery ? channels.filter(c => c.nome.includes(searchQuery)) : channels;
        list.innerHTML = filtered.map(ch => `
            <li data-channel-id="${ch.id}" class="${activeView.type === 'channel' && activeView.id === ch.id ? 'active' : ''}">
                <span class="ct-channel-hash">#</span>
                <span class="ct-nav-name">${esc(ch.nome)}</span>
            </li>`).join('');
        list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
            const ch = channels.find(c => c.id == li.dataset.channelId);
            if (ch) selectChannel(ch);
        }));
    }

    function selectChannel(channel) {
        if (activeView.type === 'channel' && activeView.id) socket.emit('chat:channel:leave', activeView.id);
        activeView = { type: 'channel', id: channel.id };
        socket.emit('chat:channel:join', channel.id);
        updateChatHeader();
        document.getElementById('ct-input').placeholder = `Mensagem em #${channel.nome}`;
        renderChannelList(); renderDMList();
        loadChannelMessages(channel.id);
    }

    async function loadChannelMessages(channelId) {
        try { const msgs = await apiFetch(`/api/chat/canais/${channelId}/mensagens`); renderMessages(msgs, 'channel'); } catch (err) { console.error('[CHAT]', err); }
    }

    async function createChannel() {
        const name = document.getElementById('ct-new-ch-name').value.trim();
        const desc = document.getElementById('ct-new-ch-desc').value.trim();
        if (!name) return;
        try {
            const data = await apiFetch('/api/chat/canais', { method: 'POST', body: JSON.stringify({ nome: name, descricao: desc }) });
            document.getElementById('ct-modal').classList.add('hidden');
            await loadChannels();
            const ch = channels.find(c => c.id === data.channel.id);
            if (ch) selectChannel(ch);
        } catch (err) { console.error('[CHAT]', err); }
    }

    // ═══════════════════════════════════════════════════════
    // DIRECT MESSAGES
    // ═══════════════════════════════════════════════════════

    async function loadUsers() {
        try { users = await apiFetch('/api/chat/usuarios'); renderDMList(); } catch (err) { console.error('[CHAT]', err); }
    }

    function renderDMList() {
        const list = document.getElementById('ct-dm-list');
        const botList = document.getElementById('ct-bot-list');
        if (!list || !botList) return;

        const bots = users.filter(u => u.isBot);
        const others = users.filter(u => u.id !== currentUser?.id && !u.isBot);
        const filtered = searchQuery ? others.filter(u => u.displayName.toLowerCase().includes(searchQuery) || (u.department||'').toLowerCase().includes(searchQuery)) : others;

        // Bot
        botList.innerHTML = bots.map(u => {
            const isActive = activeView.type === 'dm' && activeView.id === u.id;
            return `<div class="ct-dm-item ${isActive ? 'active' : ''}" data-user-id="${u.id}">
                <div class="ct-dm-avatar bot-dm-avatar" style="background:linear-gradient(135deg,#a855f7,#6366f1)">🤖<span class="ct-status-dot bot"></span></div>
                <div class="ct-dm-info"><span class="ct-dm-name">BOB I.A.</span><span class="ct-dm-dept">Assistente Virtual • TI</span></div>
            </div>`;
        }).join('');

        // Users with photo, name, department
        list.innerHTML = filtered.map(u => {
            const isActive = activeView.type === 'dm' && activeView.id === u.id;
            const status = getUserStatus(u.id);
            const avatarInner = u.foto
                ? `<img src="${u.foto.startsWith('/') ? u.foto : '/avatars/' + u.foto}" onerror="this.parentElement.textContent='${initials(u.displayName)}'" />`
                : initials(u.displayName);
            return `<div class="ct-dm-item ${isActive ? 'active' : ''}" data-user-id="${u.id}">
                <div class="ct-dm-avatar" style="background:${u.avatarColor}">${avatarInner}<span class="ct-status-dot ${status}"></span></div>
                <div class="ct-dm-info"><span class="ct-dm-name">${esc(u.displayName)}</span><span class="ct-dm-dept">${esc(u.department || 'Geral')}</span></div>
            </div>`;
        }).join('');

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
        updateChatHeader();
        document.getElementById('ct-input').placeholder = user.isBot ? 'Descreva seu problema...' : `Mensagem para ${user.displayName}`;
        renderChannelList(); renderDMList();
        loadDMMessages(user.id);
        unreadCount = Math.max(0, unreadCount - 1); updateFabBadge();
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
            titleEl.textContent = `#${ch?.nome || 'geral'}`;
            descEl.textContent = ch?.descricao || '';
            rightEl.innerHTML = `<span class="ct-online-badge" id="ct-online-count">${onlineUserIds.length} online</span>`;
        } else {
            const user = users.find(u => u.id === activeView.id);
            if (!user) return;
            const status = getUserStatus(user.id);

            if (user.isBot) {
                avatarEl.className = 'ct-header-avatar';
                avatarEl.style.background = 'linear-gradient(135deg,#a855f7,#6366f1)';
                avatarEl.innerHTML = '🤖';
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
            container.innerHTML = `<div class="ct-welcome"><span class="ct-welcome-icon">${isBot ? '🤖' : '👋'}</span><h4>${isBot ? 'BOB I.A.' : 'Bem-vindo!'}</h4><p>${isBot ? 'Assistente virtual do TI.<br>Descreva seu problema!' : 'Início da conversa. Diga olá!'}</p></div>`;
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
        if (isBot) avatarHtml = `<div class="ct-msg-avatar bot-avatar" style="background:linear-gradient(135deg,#a855f7,#6366f1)">🤖</div>`;
        else if (msg.foto) { const url = msg.foto.startsWith('/') ? msg.foto : `/avatars/${msg.foto}`; avatarHtml = `<div class="ct-msg-avatar" style="background:${color}"><img src="${url}" onerror="this.parentElement.textContent='${initials(name)}'" /></div>`; }
        else avatarHtml = `<div class="ct-msg-avatar" style="background:${color}">${initials(name)}</div>`;

        const displayName = isBot ? 'BOB I.A.' : name;
        return `<div class="ct-message${botClass}">${avatarHtml}<div class="ct-msg-body"><div class="ct-msg-header"><span class="ct-msg-author${authorCls}">${esc(displayName)}</span>${badge}<span class="ct-msg-time">${time}</span></div>${content ? `<div class="ct-msg-content">${content}</div>` : ''}${attachmentHtml}</div></div>`;
    }

    function renderAudioPlayer(url, name) {
        const bars = Array.from({ length: 30 }, () => 4 + Math.random() * 18).map(h => `<div class="ct-wave-bar" style="height:${h}px"></div>`).join('');
        return `<div class="ct-msg-audio" data-audio-url="${url}"><button class="ct-audio-play" data-playing="false">▶</button><div class="ct-audio-wave">${bars}</div><span class="ct-audio-duration">--:--</span></div>`;
    }

    function appendMessage(msg, type) {
        const container = document.getElementById('ct-messages');
        const welcome = container.querySelector('.ct-welcome');
        if (welcome) welcome.remove();
        container.insertAdjacentHTML('beforeend', renderMsg(msg));
        bindImageClicks();
        bindAudioPlayers();
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

    async function toggleRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            cancelRecording();
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorder.addEventListener('dataavailable', e => { if (e.data.size > 0) audioChunks.push(e.data); });
            mediaRecorder.start();
            recStartTime = Date.now();
            document.getElementById('ct-recording-bar').classList.add('visible');
            document.getElementById('ct-btn-mic').classList.add('recording');

            // Timer
            recInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
                document.getElementById('ct-rec-timer').textContent = formatDuration(elapsed);
                // Animate wave bars
                document.querySelectorAll('#ct-rec-waves .ct-rec-bar').forEach(bar => {
                    bar.style.height = (3 + Math.random() * 18) + 'px';
                });
            }, 150);
        } catch (err) { console.error('[CHAT] Erro no microfone:', err); alert('Não foi possível acessar o microfone.'); }
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
        mediaRecorder.addEventListener('stop', async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            clearInterval(recInterval);
            document.getElementById('ct-recording-bar').classList.remove('visible');
            document.getElementById('ct-btn-mic').classList.remove('recording');

            try {
                const formData = new FormData();
                formData.append('audio', blob, `audio-${Date.now()}.webm`);
                const token = getAuthToken();
                const res = await fetch('/api/chat/upload-audio', { method: 'POST', body: formData, headers: token ? { 'Authorization': `Bearer ${token}` } : {}, credentials: 'include' });
                if (!res.ok) throw new Error('Upload áudio falhou');
                const data = await res.json();

                const msgData = { content: '', fileUrl: data.url, fileName: data.originalName || 'Áudio', fileSize: data.size || blob.size, fileMime: 'audio/webm' };
                if (activeView.type === 'channel') socket.emit('chat:channel:message', { channelId: activeView.id, userId: currentUser.id, ...msgData });
                else socket.emit('chat:dm:message', { fromId: currentUser.id, toId: activeView.id, ...msgData });
            } catch (err) { console.error('[CHAT] Erro upload áudio:', err); }
        });
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
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
