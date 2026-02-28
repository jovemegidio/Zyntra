const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { getBobResponse } = require('./bob-knowledge');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10e6 // 10MB para áudio
});

// ==================== CONFIGURAÇÃO ====================
const PORT = process.env.PORT || 3000;

// Garantir que a pasta de uploads existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|mp3|wav|ogg|webm|mp4/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    cb(null, ext || mime);
  }
});

// ==================== MIDDLEWARE ====================
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json({ limit: '1mb' })); // SEGURANÇA: Limite de payload

// ==================== ESTADO DO SERVIDOR ====================
const users = new Map();           // socketId -> { id, name, avatar, status }
const conversations = new Map();   // odId -> { messages[], participants[], type }
const supportQueue = [];           // Fila de espera para suporte humano
const supportAgents = new Map();   // socketId -> { id, name, available, activeChats[] }

// ==================== ROTAS API ====================

// Upload de arquivo (áudio, imagem, documento)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// Upload de áudio gravado
app.post('/api/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum áudio enviado' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    duration: req.body.duration || 0,
    mimetype: req.file.mimetype
  });
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log(`🔌 Novo usuário conectado: ${socket.id}`);

  // ---------- REGISTRO DO USUÁRIO ----------
  socket.on('user:register', (userData) => {
    const user = {
      id: socket.id,
      name: userData.name || 'Usuário',
      avatar: userData.avatar || null,
      status: 'online',
      joinedAt: new Date()
    };
    users.set(socket.id, user);

    // Criar conversa com o BOB automaticamente
    const convId = `bob_${socket.id}`;
    conversations.set(convId, {
      id: convId,
      type: 'bot',
      participants: [socket.id, 'bob'],
      messages: [],
      createdAt: new Date()
    });

    socket.join(convId);
    socket.emit('user:registered', { user, conversationId: convId });

    // Mensagem de boas-vindas do BOB
    setTimeout(() => {
      const welcomeMsg = {
        id: uuidv4(),
        conversationId: convId,
        sender: 'bob',
        senderName: 'BOB',
        type: 'text',
        content: `Olá, **${user.name}**! 👋

Eu sou o **BOB**, o assistente virtual da **Aluforce**! 🤖

Estou aqui para te ajudar com qualquer dúvida sobre o sistema Aluforce ERP. Pode me perguntar sobre:

📦 **Vendas** - Pedidos, orçamentos, comissões
🛒 **Compras** - Pedidos de compra, cotações
💰 **Financeiro** - Contas, fluxo de caixa
📄 **NF-e** - Notas fiscais eletrônicas
👥 **RH** - Holerite, férias, ponto
🏭 **PCP** - Produção e estoque
📱 **App/WhatsApp** - Acesso mobile

Se eu não conseguir te ajudar, posso te transferir para nosso **suporte humano**! 

Como posso te ajudar hoje? 😊`,
        timestamp: new Date(),
        status: 'delivered'
      };
      conversations.get(convId).messages.push(welcomeMsg);
      socket.emit('message:received', welcomeMsg);
    }, 800);

    // Atualizar lista de usuários online
    io.emit('users:online', getOnlineUsers());
    console.log(`👤 Usuário registrado: ${user.name}`);
  });

  // ---------- REGISTRO DE AGENTE DE SUPORTE ----------
  socket.on('support:register', (agentData) => {
    const agent = {
      id: socket.id,
      name: agentData.name || 'Agente',
      available: true,
      activeChats: [],
      joinedAt: new Date()
    };
    supportAgents.set(socket.id, agent);
    socket.join('support-room');
    socket.emit('support:registered', agent);

    // Enviar fila de espera atual
    socket.emit('support:queue', supportQueue);
    console.log(`🎧 Agente de suporte registrado: ${agent.name}`);
  });

  // ---------- ENVIO DE MENSAGEM ----------
  socket.on('message:send', (data) => {
    const conv = conversations.get(data.conversationId);
    if (!conv) return;

    const message = {
      id: uuidv4(),
      conversationId: data.conversationId,
      sender: socket.id,
      senderName: users.get(socket.id)?.name || 'Usuário',
      type: data.type || 'text', // text, audio, image, file
      content: data.content,
      metadata: data.metadata || {},
      timestamp: new Date(),
      status: 'sent'
    };

    conv.messages.push(message);

    // Emitir para todos os participantes
    conv.participants.forEach(pid => {
      if (pid !== socket.id && pid !== 'bob') {
        io.to(pid).emit('message:received', message);
      }
    });

    // Confirmar envio
    socket.emit('message:sent', { ...message, status: 'delivered' });

    // Se a conversa é com o BOB, gerar resposta
    if (conv.type === 'bot' && data.type === 'text') {
      handleBobResponse(socket, conv, message);
    }
  });

  // ---------- ENVIO DE ÁUDIO ----------
  socket.on('audio:send', (data) => {
    const conv = conversations.get(data.conversationId);
    if (!conv) return;

    const message = {
      id: uuidv4(),
      conversationId: data.conversationId,
      sender: socket.id,
      senderName: users.get(socket.id)?.name || 'Usuário',
      type: 'audio',
      content: data.audioUrl,
      metadata: {
        duration: data.duration,
        mimetype: data.mimetype
      },
      timestamp: new Date(),
      status: 'sent'
    };

    conv.messages.push(message);

    conv.participants.forEach(pid => {
      if (pid !== socket.id && pid !== 'bob') {
        io.to(pid).emit('message:received', message);
      }
    });

    socket.emit('message:sent', { ...message, status: 'delivered' });

    // BOB responde a áudios normalmente
    if (conv.type === 'bot') {
      handleBobAudioResponse(socket, conv, message);
    }
  });

  // ---------- SOLICITAR TRANSFERÊNCIA PARA SUPORTE ----------
  socket.on('support:request', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const convId = data.conversationId;
    const conv = conversations.get(convId);

    // Criar ticket de suporte
    const ticket = {
      id: uuidv4(),
      userId: socket.id,
      userName: user.name,
      conversationId: convId,
      reason: data.reason || 'Transferência solicitada pelo usuário',
      previousMessages: conv ? conv.messages.slice(-10) : [],
      createdAt: new Date(),
      status: 'waiting'
    };

    supportQueue.push(ticket);

    // Notificar o usuário
    socket.emit('support:queued', {
      position: supportQueue.length,
      message: `Você está na fila de espera. Posição: **${supportQueue.length}**. Um agente irá te atender em breve! ⏳`
    });

    // Enviar mensagem no chat
    if (conv) {
      const sysMsg = {
        id: uuidv4(),
        conversationId: convId,
        sender: 'system',
        senderName: 'Sistema',
        type: 'system',
        content: `🔄 Transferindo para o suporte humano... Você é o **${supportQueue.length}º** na fila. Por favor, aguarde.`,
        timestamp: new Date(),
        status: 'delivered'
      };
      conv.messages.push(sysMsg);
      socket.emit('message:received', sysMsg);
    }

    // Notificar agentes disponíveis
    io.to('support-room').emit('support:new-ticket', ticket);
    io.to('support-room').emit('support:queue', supportQueue);

    console.log(`📋 Ticket de suporte criado: ${ticket.id} para ${user.name}`);
  });

  // ---------- AGENTE ACEITA ATENDIMENTO ----------
  socket.on('support:accept', (data) => {
    const agent = supportAgents.get(socket.id);
    if (!agent) return;

    const ticketIndex = supportQueue.findIndex(t => t.id === data.ticketId);
    if (ticketIndex === -1) return;

    const ticket = supportQueue.splice(ticketIndex, 1)[0];
    ticket.status = 'active';
    ticket.agentId = socket.id;
    ticket.agentName = agent.name;

    // Criar conversa de suporte
    const supportConvId = `support_${ticket.id}`;
    conversations.set(supportConvId, {
      id: supportConvId,
      type: 'support',
      participants: [ticket.userId, socket.id],
      messages: ticket.previousMessages || [],
      ticket: ticket,
      createdAt: new Date()
    });

    socket.join(supportConvId);
    agent.activeChats.push(supportConvId);

    // Notificar o usuário
    const userSocket = io.sockets.sockets.get(ticket.userId);
    if (userSocket) {
      userSocket.join(supportConvId);

      // Atualizar a conversa do usuário
      const oldConv = conversations.get(ticket.conversationId);
      if (oldConv) {
        oldConv.type = 'support';
        oldConv.participants.push(socket.id);

        const sysMsg = {
          id: uuidv4(),
          conversationId: ticket.conversationId,
          sender: 'system',
          senderName: 'Sistema',
          type: 'system',
          content: `✅ O agente **${agent.name}** entrou no chat! Agora você está conversando com o suporte humano.`,
          timestamp: new Date(),
          status: 'delivered'
        };
        oldConv.messages.push(sysMsg);
        userSocket.emit('message:received', sysMsg);
        userSocket.emit('support:connected', {
          agentName: agent.name,
          conversationId: ticket.conversationId
        });
      }
    }

    socket.emit('support:accepted', { ticket, conversationId: ticket.conversationId });

    // Atualizar fila
    io.to('support-room').emit('support:queue', supportQueue);
    console.log(`✅ Agente ${agent.name} aceitou o ticket ${ticket.id}`);
  });

  // ---------- DIGITANDO ----------
  socket.on('typing:start', (data) => {
    const conv = conversations.get(data.conversationId);
    if (!conv) return;
    const user = users.get(socket.id);
    conv.participants.forEach(pid => {
      if (pid !== socket.id && pid !== 'bob') {
        io.to(pid).emit('typing:update', { conversationId: data.conversationId, user: user?.name, isTyping: true });
      }
    });
  });

  socket.on('typing:stop', (data) => {
    const conv = conversations.get(data.conversationId);
    if (!conv) return;
    const user = users.get(socket.id);
    conv.participants.forEach(pid => {
      if (pid !== socket.id && pid !== 'bob') {
        io.to(pid).emit('typing:update', { conversationId: data.conversationId, user: user?.name, isTyping: false });
      }
    });
  });

  // ---------- DESCONEXÃO ----------
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      user.status = 'offline';
      console.log(`👋 Usuário desconectado: ${user.name}`);
    }

    const agent = supportAgents.get(socket.id);
    if (agent) {
      supportAgents.delete(socket.id);
      console.log(`👋 Agente desconectado: ${agent.name}`);
    }

    users.delete(socket.id);
    io.emit('users:online', getOnlineUsers());
  });
});

// ==================== LÓGICA DO BOB ====================
function handleBobResponse(socket, conv, userMessage) {
  // Indicador de digitação
  socket.emit('typing:update', {
    conversationId: conv.id,
    user: 'BOB',
    isTyping: true
  });

  // Verificar se o usuário quer ser transferido
  const transferKeywords = ['transferir', 'suporte', 'humano', 'atendente', 'pessoa', 'falar com alguém', 'falar com alguem', 'sim, transferir', 'quero suporte', 'atendimento humano'];
  const msgLower = userMessage.content.toLowerCase();
  const wantsTransfer = transferKeywords.some(k => msgLower.includes(k));

  setTimeout(() => {
    socket.emit('typing:update', {
      conversationId: conv.id,
      user: 'BOB',
      isTyping: false
    });

    if (wantsTransfer) {
      const botMsg = {
        id: uuidv4(),
        conversationId: conv.id,
        sender: 'bob',
        senderName: 'BOB',
        type: 'text',
        content: `Entendido! Vou te transferir para o suporte humano agora. 🔄\n\nUm momento, por favor...`,
        timestamp: new Date(),
        status: 'delivered'
      };
      conv.messages.push(botMsg);
      socket.emit('message:received', botMsg);

      // Disparar transferência automaticamente
      setTimeout(() => {
        socket.emit('support:auto-transfer', { conversationId: conv.id });
      }, 1500);
      return;
    }

    const response = getBobResponse(userMessage.content);
    const botMsg = {
      id: uuidv4(),
      conversationId: conv.id,
      sender: 'bob',
      senderName: 'BOB',
      type: 'text',
      content: response.message,
      timestamp: new Date(),
      status: 'delivered'
    };
    conv.messages.push(botMsg);
    socket.emit('message:received', botMsg);

    // Se o BOB não encontrou resposta, sugerir suporte
    if (response.type === 'no_answer') {
      setTimeout(() => {
        socket.emit('support:suggest', {
          conversationId: conv.id,
          message: 'Deseja ser transferido para o suporte humano?'
        });
      }, 500);
    }
  }, 1200 + Math.random() * 800); // Delay realista de digitação
}

// ==================== BOB - RESPOSTA A ÁUDIOS ====================
function handleBobAudioResponse(socket, conv, audioMessage) {
  // Indicador de digitação
  socket.emit('typing:update', {
    conversationId: conv.id,
    user: 'BOB',
    isTyping: true
  });

  // Analisar contexto: pegar as últimas mensagens de texto do usuário para dar contexto
  const recentUserMessages = conv.messages
    .filter(m => m.sender !== 'bob' && m.type === 'text')
    .slice(-3)
    .map(m => m.content)
    .join(' ');

  setTimeout(() => {
    socket.emit('typing:update', {
      conversationId: conv.id,
      user: 'BOB',
      isTyping: false
    });

    let responseText;

    // Se houver mensagens recentes de texto, tentar responder com base no contexto
    if (recentUserMessages && recentUserMessages.trim().length > 5) {
      const contextResponse = getBobResponse(recentUserMessages);
      if (contextResponse.type === 'answer') {
        responseText = `Recebi seu áudio! 🎙️ Com base na nossa conversa, acredito que isso pode te ajudar:\n\n${contextResponse.message}`;
      }
    }

    // Resposta padrão amigável para áudios
    if (!responseText) {
      responseText = `Recebi seu áudio! 🎙️ Ouvi sua mensagem!

Para garantir que eu entenda sua dúvida com precisão, aqui vão algumas sugestões do que posso te ajudar:

📦 **Vendas** — Pedidos, orçamentos, faturamento
🛒 **Compras** — Pedidos, cotações, fornecedores
💰 **Financeiro** — Contas a pagar/receber, fluxo de caixa
📄 **NF-e / NFS-e** — Emissão, cancelamento, correção
👥 **RH** — Holerite, férias, ponto eletrônico
🏭 **Produção** — Ordens, estoque, BOM

Me diga sobre qual assunto é sua dúvida que eu elaboro uma resposta completa! 😊

Se preferir, posso te **transferir para o suporte humano**. 🎧`;
    }

    const botMsg = {
      id: uuidv4(),
      conversationId: conv.id,
      sender: 'bob',
      senderName: 'BOB',
      type: 'text',
      content: responseText,
      timestamp: new Date(),
      status: 'delivered'
    };
    conv.messages.push(botMsg);
    socket.emit('message:received', botMsg);
  }, 1500 + Math.random() * 500);
}

// ==================== HELPERS ====================
function getOnlineUsers() {
  const online = [];
  users.forEach((user) => {
    if (user.status === 'online') {
      online.push({ id: user.id, name: user.name, avatar: user.avatar });
    }
  });
  return online;
}

// ==================== ROTA PAINEL SUPORTE ====================
app.get('/suporte', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'support.html'));
});

// ==================== INICIAR SERVIDOR ====================
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🤖 ALUFORCE CHAT - BOB Assistente Virtual       ║
║                                                   ║
║   💬 Chat:    http://localhost:${PORT}              ║
║   🎧 Suporte: http://localhost:${PORT}/suporte     ║
║                                                   ║
║   Status: ✅ Online                               ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});
