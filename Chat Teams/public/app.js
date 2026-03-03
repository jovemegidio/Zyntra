/* ═══════════════════════════════════════════════════════════
   CHAT CORPORATIVO - FRONTEND
   ═══════════════════════════════════════════════════════════ */

const socket = io();

// ── Estado ────────────────────────────────────────────────
let currentUser = null;
let channels = [];
let users = [];
let onlineUserIds = [];
let activeView = { type: 'channel', id: null };
let typingTimeout = null;

// ── Elementos ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const loginScreen = $('#login-screen');
const chatScreen = $('#chat-screen');

// ═══ AUTENTICAÇÃO ════════════════════════════════════════

$('#show-register').addEventListener('click', (e) => {
  e.preventDefault();
  $('#login-form').classList.add('hidden');
  $('#register-form').classList.remove('hidden');
});

$('#show-login').addEventListener('click', (e) => {
  e.preventDefault();
  $('#register-form').classList.add('hidden');
  $('#login-form').classList.remove('hidden');
});

$('#btn-login').addEventListener('click', async () => {
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  if (!username || !password) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    enterChat(data.user);
  } catch (e) {
    $('#login-error').textContent = e.message;
  }
});

$('#btn-register').addEventListener('click', async () => {
  const displayName = $('#reg-display').value.trim();
  const username = $('#reg-username').value.trim();
  const password = $('#reg-password').value;
  const department = $('#reg-department').value;

  if (!displayName || !username || !password) {
    $('#register-error').textContent = 'Preencha todos os campos';
    return;
  }

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, department })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    enterChat(data.user);
  } catch (e) {
    $('#register-error').textContent = e.message;
  }
});

// Enter para login
$('#login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-login').click();
});

$('#reg-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-register').click();
});

// ═══ ENTRAR NO CHAT ══════════════════════════════════════

async function enterChat(user) {
  currentUser = user;
  loginScreen.classList.remove('active');
  chatScreen.classList.add('active');

  // Mostrar info do usuário
  $('#current-user-info').innerHTML = `
    <div class="user-avatar" style="background:${user.avatarColor}">${getInitials(user.displayName)}</div>
    <div class="user-badge-info">
      <span class="user-badge-name">${escapeHtml(user.displayName)}</span>
      <span class="user-badge-dept">${escapeHtml(user.department)}</span>
    </div>
  `;

  // Notificar servidor
  socket.emit('user:online', user);

  // Carregar dados
  await Promise.all([loadChannels(), loadUsers()]);

  // Selecionar canal geral
  if (channels.length > 0) {
    selectChannel(channels.find(c => c.name === 'geral') || channels[0]);
  }
}

// Logout
$('#btn-logout').addEventListener('click', () => {
  currentUser = null;
  chatScreen.classList.remove('active');
  loginScreen.classList.add('active');
  socket.disconnect();
  socket.connect();
  // Limpar campos
  $('#login-username').value = '';
  $('#login-password').value = '';
  $('#login-error').textContent = '';
});

// ═══ CANAIS ══════════════════════════════════════════════

async function loadChannels() {
  const res = await fetch('/api/channels');
  channels = await res.json();
  renderChannelList();
}

function renderChannelList() {
  const list = $('#channel-list');
  list.innerHTML = channels.map(ch => `
    <li data-channel-id="${ch.id}" class="${activeView.type === 'channel' && activeView.id === ch.id ? 'active' : ''}">
      <span class="channel-hash">#</span>
      <span>${escapeHtml(ch.name)}</span>
    </li>
  `).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const ch = channels.find(c => c.id === li.dataset.channelId);
      if (ch) selectChannel(ch);
    });
  });
}

function selectChannel(channel) {
  // Sair do canal anterior
  if (activeView.type === 'channel' && activeView.id) {
    socket.emit('channel:leave', activeView.id);
  }

  activeView = { type: 'channel', id: channel.id };
  socket.emit('channel:join', channel.id);

  $('#chat-title').textContent = `#${channel.name}`;
  $('#chat-description').textContent = channel.description || '';
  $('#message-input').placeholder = `Mensagem em #${channel.name}`;

  renderChannelList();
  renderDMList();
  loadChannelMessages(channel.id);
}

async function loadChannelMessages(channelId) {
  const res = await fetch(`/api/channels/${channelId}/messages`);
  const messages = await res.json();
  renderMessages(messages, 'channel');
}

// ═══ MENSAGENS DIRETAS ═══════════════════════════════════

async function loadUsers() {
  const res = await fetch('/api/users');
  users = await res.json();
  renderDMList();
}

function renderDMList() {
  const list = $('#dm-list');
  const botList = $('#bot-list');
  const otherUsers = users.filter(u => u.id !== currentUser?.id && !u.isBot);
  const bots = users.filter(u => u.isBot);

  // Renderizar bot
  botList.innerHTML = bots.map(u => `
    <li data-user-id="${u.id}" class="${activeView.type === 'dm' && activeView.id === u.id ? 'active' : ''}">
      <span class="user-status bot"></span>
      <span>🤖 ${escapeHtml(u.displayName)}</span>
    </li>
  `).join('');

  botList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const user = users.find(u => u.id === li.dataset.userId);
      if (user) selectDM(user);
    });
  });

  // Renderizar usuários normais
  list.innerHTML = otherUsers.map(u => `
    <li data-user-id="${u.id}" class="${activeView.type === 'dm' && activeView.id === u.id ? 'active' : ''}">
      <span class="user-status ${onlineUserIds.includes(u.id) ? 'online' : ''}"></span>
      <span>${escapeHtml(u.displayName)}</span>
    </li>
  `).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const user = users.find(u => u.id === li.dataset.userId);
      if (user) selectDM(user);
    });
  });
}

function selectDM(user) {
  // Sair do canal anterior
  if (activeView.type === 'channel' && activeView.id) {
    socket.emit('channel:leave', activeView.id);
  }

  activeView = { type: 'dm', id: user.id };

  const botBadge = user.isBot ? '<span class="chat-header-bot-badge">🤖 I.A.</span>' : '';
  $('#chat-title').innerHTML = escapeHtml(user.displayName) + botBadge;
  $('#chat-description').textContent = user.isBot ? 'Suporte automático 24/7 • TI' : (user.department || '');
  $('#message-input').placeholder = user.isBot ? 'Descreva seu problema...' : `Mensagem para ${user.displayName}`;

  renderChannelList();
  renderDMList();
  loadDMMessages(user.id);
}

async function loadDMMessages(otherId) {
  const res = await fetch(`/api/dm/${currentUser.id}/${otherId}`);
  const messages = await res.json();
  renderMessages(messages, 'dm');
}

// ═══ RENDERIZAR MENSAGENS ════════════════════════════════

function renderMessages(messages, type) {
  const container = $('#messages');

  if (messages.length === 0) {
    // Verificar se é DM com bot
    const targetUser = activeView.type === 'dm' ? users.find(u => u.id === activeView.id) : null;
    const isBot = targetUser?.isBot;

    if (isBot) {
      container.innerHTML = `
        <div class="welcome-message">
          <span class="welcome-icon">🤖</span>
          <h3>Suporte I.A.</h3>
          <p>Olá! Sou o assistente virtual do TI.<br>Descreva seu problema e vou ajudar!</p>
          <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">Disponível 24/7 • Respostas instantâneas</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="welcome-message">
          <span class="welcome-icon">👋</span>
          <h3>Bem-vindo!</h3>
          <p>Esta é o início da conversa. Diga olá!</p>
        </div>
      `;
    }
    scrollToBottom();
    return;
  }

  let html = '';
  let lastDate = '';

  messages.forEach(msg => {
    const date = formatDate(msg.createdAt);
    if (date !== lastDate) {
      html += `<div class="message-divider">${date}</div>`;
      lastDate = date;
    }
    html += renderMessage(msg);
  });

  container.innerHTML = html;
  scrollToBottom();
}

function renderMessage(msg) {
  const name = msg.displayName || 'Desconhecido';
  const color = msg.avatarColor || '#4F46E5';
  const time = formatTime(msg.createdAt);
  const isBot = msg.isBot || name === 'Suporte I.A.';
  const botClass = isBot ? ' bot-message' : '';
  const avatarClass = isBot ? ' bot-avatar' : '';
  const authorClass = isBot ? ' bot-author' : '';
  const avatarContent = isBot ? '🤖' : getInitials(name);
  const badge = isBot ? '<span class="bot-badge">I.A.</span>' : '';

  // Processar markdown básico para respostas do bot
  let content = escapeHtml(msg.content);
  if (isBot) {
    content = content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(168,85,247,0.15);padding:2px 6px;border-radius:4px;font-size:13px">$1</code>')
      .replace(/•/g, '&nbsp;&nbsp;•');
  }

  return `
    <div class="message${botClass}" data-msg-id="${msg.id}">
      <div class="message-avatar${avatarClass}" style="background:${color}">${avatarContent}</div>
      <div class="message-body">
        <div class="message-header">
          <span class="message-author${authorClass}">${escapeHtml(name)}</span>
          ${badge}
          <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${content}</div>
      </div>
    </div>
  `;
}

function appendMessage(msg) {
  const container = $('#messages');
  // Remover mensagem de boas-vindas se existir
  const welcome = container.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  container.insertAdjacentHTML('beforeend', renderMessage(msg));
  scrollToBottom();
}

function scrollToBottom() {
  const area = $('#messages-container');
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}

// ═══ ENVIAR MENSAGEM ═════════════════════════════════════

$('#btn-send').addEventListener('click', sendMessage);

$('#message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
$('#message-input').addEventListener('input', () => {
  const textarea = $('#message-input');
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';

  // Typing indicator
  if (activeView.type === 'channel') {
    socket.emit('typing:start', { channelId: activeView.id, user: currentUser.displayName });
  } else {
    socket.emit('typing:start', { toId: activeView.id, user: currentUser.displayName });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (activeView.type === 'channel') {
      socket.emit('typing:stop', { channelId: activeView.id, user: currentUser.displayName });
    } else {
      socket.emit('typing:stop', { toId: activeView.id, user: currentUser.displayName });
    }
  }, 2000);
});

function sendMessage() {
  const input = $('#message-input');
  const content = input.value.trim();
  if (!content) return;

  if (activeView.type === 'channel') {
    socket.emit('channel:message', {
      channelId: activeView.id,
      userId: currentUser.id,
      content
    });
  } else {
    socket.emit('dm:message', {
      fromId: currentUser.id,
      toId: activeView.id,
      content
    });
  }

  input.value = '';
  input.style.height = 'auto';

  // Stop typing
  if (activeView.type === 'channel') {
    socket.emit('typing:stop', { channelId: activeView.id, user: currentUser.displayName });
  } else {
    socket.emit('typing:stop', { toId: activeView.id, user: currentUser.displayName });
  }
}

// ═══ SOCKET EVENTS ═══════════════════════════════════════

socket.on('channel:message', (msg) => {
  if (activeView.type === 'channel' && activeView.id === msg.channelId) {
    appendMessage(msg);
  }
});

socket.on('dm:message', (msg) => {
  if (activeView.type === 'dm') {
    const otherId = activeView.id;
    if (msg.fromId === otherId || msg.fromId === currentUser.id) {
      appendMessage(msg);
    }
  }
});

socket.on('users:online', (ids) => {
  onlineUserIds = ids;
  renderDMList();
  $('#online-count').textContent = `${ids.length} online`;
});

socket.on('channel:created', (channel) => {
  if (!channels.find(c => c.id === channel.id)) {
    channels.push(channel);
    renderChannelList();
  }
});

// Typing
const typingUsers = new Set();

socket.on('typing:start', (data) => {
  if (data.user === currentUser?.displayName) return;
  if (data.isBot) {
    const el = $('#typing-indicator');
    el.classList.remove('hidden');
    el.innerHTML = `🤖 Suporte I.A. está digitando <span class="bot-typing-dots"><span></span><span></span><span></span></span>`;
    return;
  }
  typingUsers.add(data.user);
  updateTypingIndicator();
});

socket.on('typing:stop', (data) => {
  typingUsers.delete(data.user);
  updateTypingIndicator();
});

function updateTypingIndicator() {
  const el = $('#typing-indicator');
  if (typingUsers.size === 0) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    const names = Array.from(typingUsers);
    if (names.length === 1) {
      el.textContent = `${names[0]} está digitando...`;
    } else {
      el.textContent = `${names.join(', ')} estão digitando...`;
    }
  }
}

// ═══ MODAL NOVO CANAL ════════════════════════════════════

$('#btn-new-channel').addEventListener('click', () => {
  $('#modal-overlay').classList.remove('hidden');
  $('#new-channel-name').value = '';
  $('#new-channel-desc').value = '';
  $('#new-channel-name').focus();
});

$('#btn-cancel-channel').addEventListener('click', () => {
  $('#modal-overlay').classList.add('hidden');
});

$('#modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#modal-overlay')) {
    $('#modal-overlay').classList.add('hidden');
  }
});

$('#btn-create-channel').addEventListener('click', async () => {
  const name = $('#new-channel-name').value.trim();
  const description = $('#new-channel-desc').value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, createdBy: currentUser.id })
    });
    const data = await res.json();
    if (res.ok) {
      $('#modal-overlay').classList.add('hidden');
      await loadChannels();
      const ch = channels.find(c => c.id === data.channel.id);
      if (ch) selectChannel(ch);
    }
  } catch (e) {
    console.error(e);
  }
});

$('#new-channel-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-create-channel').click();
});

// ═══ UTILITÁRIOS ═════════════════════════════════════════

function getInitials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
