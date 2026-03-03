const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── REST API ──────────────────────────────────────────────

// Registro
app.post('/api/register', (req, res) => {
  const { username, displayName, password, department } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Campos obrigatórios: username, displayName, password' });
  }
  try {
    const user = db.createUser(username, displayName, password, department || 'Geral');
    res.json({ ok: true, user });
  } catch (e) {
    res.status(409).json({ error: 'Usuário já existe' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.authenticateUser(username, password);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
  res.json({ ok: true, user });
});

// Listar usuários
app.get('/api/users', (req, res) => {
  res.json(db.getUsers());
});

// Listar canais
app.get('/api/channels', (req, res) => {
  res.json(db.getChannels());
});

// Criar canal
app.post('/api/channels', (req, res) => {
  const { name, description, createdBy } = req.body;
  try {
    const channel = db.createChannel(name, description, createdBy);
    io.emit('channel:created', channel);
    res.json({ ok: true, channel });
  } catch (e) {
    res.status(409).json({ error: 'Canal já existe' });
  }
});

// Mensagens de canal
app.get('/api/channels/:channelId/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(db.getChannelMessages(req.params.channelId, limit));
});

// Mensagens diretas
app.get('/api/dm/:myId/:otherId', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(db.getDirectMessages(req.params.myId, req.params.otherId, limit));
});

// ── SOCKET.IO (Tempo Real) ────────────────────────────────

const onlineUsers = new Map(); // oderId -> { socketId, user }

io.on('connection', (socket) => {
  console.log(`🔌 Conectado: ${socket.id}`);

  // Usuário entra online
  socket.on('user:online', (user) => {
    onlineUsers.set(user.id, { socketId: socket.id, user });
    socket.userId = user.id;
    io.emit('users:online', Array.from(onlineUsers.keys()));
  });

  // Entrar em canal
  socket.on('channel:join', (channelId) => {
    socket.join(`channel:${channelId}`);
  });

  // Sair de canal
  socket.on('channel:leave', (channelId) => {
    socket.leave(`channel:${channelId}`);
  });

  // Mensagem em canal
  socket.on('channel:message', (data) => {
    const msg = db.saveChannelMessage(data.channelId, data.userId, data.content);
    io.to(`channel:${data.channelId}`).emit('channel:message', msg);
  });

  // Mensagem direta
  socket.on('dm:message', (data) => {
    const msg = db.saveDirectMessage(data.fromId, data.toId, data.content);
    // Enviar para remetente e destinatário
    socket.emit('dm:message', msg);
    const target = onlineUsers.get(data.toId);
    if (target) {
      io.to(target.socketId).emit('dm:message', msg);
    }

    // ── BOT I.A. de Suporte ──────────────────────────────
    const bot = db.getBotUser();
    if (data.toId === bot.id) {
      // Verificar se há alguém do TI online (que não seja o bot)
      const tiOnline = Array.from(onlineUsers.values()).some(ou =>
        ou.user.department === 'TI' && ou.user.id !== bot.id
      );

      // Indicar que bot está "digitando"
      setTimeout(() => {
        socket.emit('typing:start', { toId: data.fromId, user: bot.displayName, isBot: true });
      }, 300);

      // Gerar resposta com delay natural
      const delay = 1200 + Math.random() * 1500;
      setTimeout(() => {
        socket.emit('typing:stop', { toId: data.fromId, user: bot.displayName });
        const response = generateBotResponse(data.content, tiOnline);
        const botMsg = db.saveDirectMessage(bot.id, data.fromId, response);
        botMsg.isBot = true;
        socket.emit('dm:message', botMsg);
      }, delay);
    }
  });

  // Indicador de digitação
  socket.on('typing:start', (data) => {
    if (data.channelId) {
      socket.to(`channel:${data.channelId}`).emit('typing:start', data);
    } else if (data.toId) {
      const target = onlineUsers.get(data.toId);
      if (target) io.to(target.socketId).emit('typing:start', data);
    }
  });

  socket.on('typing:stop', (data) => {
    if (data.channelId) {
      socket.to(`channel:${data.channelId}`).emit('typing:stop', data);
    } else if (data.toId) {
      const target = onlineUsers.get(data.toId);
      if (target) io.to(target.socketId).emit('typing:stop', data);
    }
  });

  // Desconexão
  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit('users:online', Array.from(onlineUsers.keys()));
    }
    console.log(`❌ Desconectado: ${socket.id}`);
  });
});

// ── BOT I.A. — Base de Conhecimento ───────────────────────

function generateBotResponse(userMessage, tiIsOnline) {
  const msg = userMessage.toLowerCase().trim();

  // Saudações
  if (/^(oi|olá|ola|hey|hello|bom dia|boa tarde|boa noite|e aí|eae|fala)/i.test(msg)) {
    const greetings = [
      `Olá! 👋 Sou o Suporte I.A., assistente virtual do departamento de TI.\n\nComo posso ajudar você hoje?`,
      `Oi! 🤖 Estou aqui para ajudar com questões de TI.\n\nMe conte o que está acontecendo!`,
      `Olá! Bem-vindo ao suporte técnico virtual! 💡\n\nDescreva seu problema que vou tentar ajudar.`
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  // Senha / Acesso
  if (/senha|password|login|acesso|acessar|entrar|esqueci|redefinir|resetar|trocar senha/i.test(msg)) {
    if (tiIsOnline) {
      return `🔐 **Problemas com senha/acesso?**\n\nUm técnico do TI está online agora! Recomendo enviar uma mensagem direta para ele para redefinição imediata.\n\nEnquanto isso, tente:\n• Verifique se o Caps Lock está desativado\n• Tente o último password que você lembra\n• Limpe o cache do navegador (Ctrl+Shift+Del)`;
    }
    return `🔐 **Problemas com senha/acesso?**\n\nO TI não está online no momento, mas posso orientar:\n\n1. Verifique se o **Caps Lock** está desativado\n2. Tente utilizar a opção **"Esqueci minha senha"** na tela de login do sistema\n3. Limpe o cache do navegador: **Ctrl+Shift+Del**\n4. Se o problema persistir, anote os detalhes e o TI resolverá assim que retornar\n\n⏰ Horário do TI: Seg-Sex, 8h às 18h`;
  }

  // Internet / Rede / Wi-Fi
  if (/internet|rede|wifi|wi-fi|conexão|conectar|desconect|lento|lenta|velocidade|ping|caiu|sem rede/i.test(msg)) {
    return `🌐 **Problemas de conectividade?**\n\nTente estes passos:\n\n1. **Reinicie seu roteador/modem** — desligue, espere 30s, religue\n2. Desconecte e reconecte o **Wi-Fi**\n3. No Windows: abra o CMD e digite \`ipconfig /release\` depois \`ipconfig /renew\`\n4. Teste em outro dispositivo para verificar se é local\n5. Tente usar o cabo de rede diretamente\n\n${tiIsOnline ? '✅ Há um técnico do TI online, encaminhe o caso se persistir!' : '⏰ O TI está offline. Se persistir, registre o horário e detalhes do problema.'}`;
  }

  // Impressora
  if (/impress|printer|impressora|imprimir|papel|toner|scanner|scan|digitaliz/i.test(msg)) {
    return `🖨️ **Problemas com impressora?**\n\n1. Verifique se está **ligada e conectada**\n2. Veja se há **papel preso** (abra as tampas e verifique)\n3. Reinicie a impressora\n4. No PC: **Painel de Controle → Dispositivos e Impressoras** → verifique se está como padrão\n5. Remova trabalhos presos na fila de impressão\n\nSe for problema de **toner/cartucho**: verifique o nível nos LEDs da impressora.\n\n${tiIsOnline ? '✅ TI online para ajudar mais!' : '⏰ O TI resolverá quando retornar.'}`;
  }

  // E-mail / Outlook
  if (/email|e-mail|outlook|correio|enviar email|receber email|spam|anexo/i.test(msg)) {
    return `📧 **Problemas com e-mail?**\n\n1. Verifique sua **conexão com a internet**\n2. Tente acessar pelo **webmail** (navegador) para isolar o problema\n3. No Outlook: **Arquivo → Configurações de Conta** → verifique se está correto\n4. Limpe a caixa de entrada se estiver cheia\n5. Verifique a pasta de **Spam/Lixo Eletrônico**\n\nSe não consegue **enviar anexos**: verifique se o arquivo não excede o limite (geralmente 25MB).\n\n${tiIsOnline ? '✅ Encaminhe ao TI online para verificação da conta!' : '📝 Anote o erro exato e reporte ao TI.'}`;
  }

  // Computador lento
  if (/lento|lenta|travando|trava|demora|congelou|congelando|memória|ram|performance|desempenho/i.test(msg)) {
    return `🖥️ **Computador lento/travando?**\n\n1. **Reinicie o computador** (resolve 80% dos casos!)\n2. Feche programas que não está usando (**Ctrl+Alt+Del → Gerenciador de Tarefas**)\n3. Verifique o espaço em disco: precisa de pelo menos 10% livre\n4. Desative programas na **inicialização**: Gerenciador de Tarefas → Inicializar\n5. Faça uma **limpeza de disco**: pesquise "Limpeza de Disco" no menu Iniciar\n\n🔄 Se persistir após reiniciar, pode ser necessário mais RAM ou verificação de malware.\n\n${tiIsOnline ? '✅ O TI pode fazer uma verificação remota agora!' : '⏰ Agende uma verificação com o TI.'}`;
  }

  // Software / Programa / Instalar
  if (/instalar|programa|software|aplicativo|app|atualizar|atualização|update|licença|ativar/i.test(msg)) {
    return `💿 **Instalação/Atualização de Software?**\n\nPor política de segurança:\n\n• Instalações devem ser solicitadas ao **departamento de TI**\n• Não instale programas de fontes desconhecidas\n• Atualizações do Windows: geralmente são automáticas\n\n${tiIsOnline ? '✅ Solicite diretamente ao técnico do TI que está online!' : '📝 Anote o software necessário e solicite ao TI quando estiver disponível.\n\n⏰ Horário do TI: Seg-Sex, 8h às 18h'}`;
  }

  // VPN
  if (/vpn|remoto|acesso remoto|home.?office|trabalhar.?de.?casa|casa/i.test(msg)) {
    return `🔒 **VPN / Acesso Remoto?**\n\n1. Verifique se o **cliente VPN** está instalado\n2. Use as credenciais corporativas para conectar\n3. Se não conecta:\n   • Verifique sua internet\n   • Reinicie o software da VPN\n   • Tente outro servidor, se disponível\n\n${tiIsOnline ? '✅ O TI pode verificar suas permissões de VPN agora!' : '⏰ Solicite ao TI a configuração/permissão quando estiver online.'}`;
  }

  // Vírus / Segurança
  if (/vírus|virus|malware|segurança|seguranca|hack|invasão|phishing|suspeito|antivírus|antivirus/i.test(msg)) {
    return `🛡️ **Alerta de Segurança!**\n\n⚠️ Se suspeita de vírus/invasão:\n\n1. **NÃO clique** em links suspeitos\n2. **Desconecte** da rede imediatamente\n3. **NÃO desligue** o computador (preservar evidências)\n4. Execute uma verificação completa do **antivírus**\n5. Mude suas senhas de outro dispositivo\n\n${tiIsOnline ? '🚨 URGENTE: Contate o TI online IMEDIATAMENTE!' : '🚨 Mantenha o PC desconectado e notifique o TI assim que estiver disponível!'}`;
  }

  // Obrigado
  if (/obrigad|valeu|thanks|brigad|show|perfeito|resolveu|funcionou|consegui/i.test(msg)) {
    const thanks = [
      `De nada! 😊 Fico feliz em ajudar! Se precisar de mais alguma coisa, é só chamar.`,
      `Disponha! 🤖 Estou aqui 24/7 para ajudar. Bom trabalho!`,
      `Que bom que ajudou! ✅ Qualquer outra dúvida, estou por aqui!`
    ];
    return thanks[Math.floor(Math.random() * thanks.length)];
  }

  // Ajuda geral
  if (/ajuda|help|menu|opções|opcoes|o que você faz|comandos/i.test(msg)) {
    return `🤖 **Sou o Suporte I.A.!** Posso ajudar com:\n\n🔐 **Senha e Acesso** — problemas de login e redefinição\n🌐 **Internet/Rede** — conectividade e Wi-Fi\n🖨️ **Impressora** — problemas de impressão\n📧 **E-mail** — Outlook e configurações\n🖥️ **PC Lento** — performance e travamentos\n💿 **Software** — instalação e atualizações\n🔒 **VPN** — acesso remoto\n🛡️ **Segurança** — vírus e ameaças\n\nDigite sobre seu problema e vou orientar! 💡\n\n${tiIsOnline ? '✅ O TI está online também para casos complexos.' : '⏰ O TI está offline. Estou aqui para cobrir!'}`;
  }

  // Resposta padrão
  if (tiIsOnline) {
    return `🤖 Entendi sua dúvida!\n\nPara esse tipo de questão, recomendo contatar diretamente o **técnico do TI** que está online agora — ele poderá resolver mais rapidamente!\n\nSe preferir, me diga mais detalhes que tentarei ajudar.\n\nDigite **"ajuda"** para ver tudo que posso fazer.`;
  }

  return `🤖 Entendi! Vou tentar ajudar.\n\nNo momento, o **TI está offline**. Aqui vão algumas orientações gerais:\n\n1. **Reinicie** o equipamento/serviço com problema\n2. Verifique se o problema ocorre com outros colegas\n3. Anote a **mensagem de erro** exata (se houver)\n4. Anote **horário** e **frequência** do problema\n\nAssim que o TI retornar, essas informações ajudarão a resolver mais rápido!\n\n💡 Digite **"ajuda"** para ver os temas que posso orientar.`;
}

// ── INICIAR ───────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏢 Chat Corporativo rodando em http://localhost:${PORT}\n`);
});
