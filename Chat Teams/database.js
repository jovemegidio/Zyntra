const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');

// ── Armazenamento em arquivo JSON ─────────────────────────
const DB_PATH = path.join(__dirname, 'chat-data.json');

let data = {
  users: [],
  channels: [],
  channelMessages: [],
  directMessages: []
};

// Carregar dados existentes
function loadData() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      data = JSON.parse(raw);
    }
  } catch (e) {
    console.log('⚠️  Criando novo banco de dados...');
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erro ao salvar dados:', e.message);
  }
}

// Inicializar
loadData();

// ── Criar usuário bot de suporte I.A. ─────────────────────
const BOT_USERNAME = 'suporte-ia';
const BOT_ID_KEY = '__bot_id__';

function ensureBotUser() {
  let bot = data.users.find(u => u.username === BOT_USERNAME);
  if (!bot) {
    bot = {
      id: 'bot-suporte-ia-' + uuid().slice(0, 8),
      username: BOT_USERNAME,
      displayName: 'Suporte I.A.',
      passwordHash: '__bot_no_login__',
      department: 'TI',
      avatarColor: '#a855f7',
      isBot: true,
      createdAt: new Date().toISOString()
    };
    data.users.push(bot);
    saveData();
  }
  return bot;
}

const botUser = ensureBotUser();

function getBotUser() {
  return {
    id: botUser.id,
    username: botUser.username,
    displayName: botUser.displayName,
    department: botUser.department,
    avatarColor: botUser.avatarColor,
    isBot: true
  };
}

// Criar canais padrão se não existem
if (data.channels.length === 0) {
  data.channels.push(
    { id: uuid(), name: 'geral', description: 'Canal geral da empresa', created_by: null, created_at: new Date().toISOString() },
    { id: uuid(), name: 'ti', description: 'Canal do departamento de TI', created_by: null, created_at: new Date().toISOString() },
    { id: uuid(), name: 'rh', description: 'Canal de Recursos Humanos', created_by: null, created_at: new Date().toISOString() },
    { id: uuid(), name: 'projetos', description: 'Discussão de projetos', created_by: null, created_at: new Date().toISOString() }
  );
  saveData();
}

// ── FUNÇÕES ───────────────────────────────────────────────

const AVATAR_COLORS = ['#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#2563EB'];

function createUser(username, displayName, password, department) {
  const existing = data.users.find(u => u.username === username.toLowerCase());
  if (existing) throw new Error('Usuário já existe');

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  const user = {
    id,
    username: username.toLowerCase(),
    displayName,
    passwordHash,
    department: department || 'Geral',
    avatarColor,
    createdAt: new Date().toISOString()
  };

  data.users.push(user);
  saveData();

  return { id, username: user.username, displayName, department: user.department, avatarColor };
}

function authenticateUser(username, password) {
  const user = data.users.find(u => u.username === username?.toLowerCase());
  if (!user) return null;
  if (user.isBot) return null; // Bot não faz login
  if (!bcrypt.compareSync(password, user.passwordHash)) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    department: user.department,
    avatarColor: user.avatarColor
  };
}

function getUsers() {
  return data.users
    .map(u => ({ id: u.id, username: u.username, displayName: u.displayName, department: u.department, avatarColor: u.avatarColor, isBot: !!u.isBot }))
    .sort((a, b) => {
      // Bot sempre primeiro na lista
      if (a.isBot && !b.isBot) return -1;
      if (!a.isBot && b.isBot) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

function getChannels() {
  return data.channels
    .map(c => ({ id: c.id, name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createChannel(name, description, createdBy) {
  const cleanName = name.toLowerCase().replace(/\s+/g, '-');
  const existing = data.channels.find(c => c.name === cleanName);
  if (existing) throw new Error('Canal já existe');

  const id = uuid();
  const channel = {
    id,
    name: cleanName,
    description: description || '',
    created_by: createdBy,
    created_at: new Date().toISOString()
  };

  data.channels.push(channel);
  saveData();

  return { id, name: cleanName, description: channel.description };
}

function saveChannelMessage(channelId, userId, content) {
  const id = uuid();
  const now = new Date().toISOString();
  const user = data.users.find(u => u.id === userId);

  const msg = { id, channelId, userId, content, createdAt: now };
  data.channelMessages.push(msg);
  saveData();

  return {
    id, channelId, userId, content, createdAt: now,
    displayName: user?.displayName || 'Desconhecido',
    avatarColor: user?.avatarColor || '#4F46E5'
  };
}

function getChannelMessages(channelId, limit = 100) {
  return data.channelMessages
    .filter(m => m.channelId === channelId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit)
    .map(m => {
      const user = data.users.find(u => u.id === m.userId);
      return {
        id: m.id, channelId: m.channelId, userId: m.userId,
        content: m.content, createdAt: m.createdAt,
        displayName: user?.displayName || 'Desconhecido',
        avatarColor: user?.avatarColor || '#4F46E5'
      };
    });
}

function saveDirectMessage(fromId, toId, content) {
  const id = uuid();
  const now = new Date().toISOString();
  const user = data.users.find(u => u.id === fromId);

  const msg = { id, fromId, toId, content, createdAt: now };
  data.directMessages.push(msg);
  saveData();

  return {
    id, fromId, toId, content, createdAt: now,
    displayName: user?.displayName || 'Desconhecido',
    avatarColor: user?.avatarColor || '#4F46E5'
  };
}

function getDirectMessages(myId, otherId, limit = 100) {
  return data.directMessages
    .filter(m =>
      (m.fromId === myId && m.toId === otherId) ||
      (m.fromId === otherId && m.toId === myId)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit)
    .map(m => {
      const user = data.users.find(u => u.id === m.fromId);
      return {
        id: m.id, fromId: m.fromId, toId: m.toId,
        content: m.content, createdAt: m.createdAt,
        displayName: user?.displayName || 'Desconhecido',
        avatarColor: user?.avatarColor || '#4F46E5'
      };
    });
}

module.exports = {
  createUser,
  authenticateUser,
  getUsers,
  getChannels,
  createChannel,
  saveChannelMessage,
  getChannelMessages,
  saveDirectMessage,
  getDirectMessages,
  getBotUser
};
