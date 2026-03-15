'use strict';

/**
 * Socket.IO Setup — extracted from server.js tryPort() closure
 * Configures: CORS, Redis adapter, JWT auth middleware, chat handlers, socket events
 */
const jwt = require('jsonwebtoken');

function setupSocketIO(httpServer, { Server, allowedOrigins, JWT_SECRET, pool }) {
    const io = new Server(httpServer, {
        cors: {
            origin: function(origin, callback) {
                if (!origin) {
                    if (process.env.NODE_ENV === 'development') return callback(null, true);
                    return callback(null, false);
                }
                if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
                    callback(null, true);
                } else {
                    console.warn(`⚠️ Socket.IO CORS bloqueado: ${origin}`);
                    callback(new Error('Origem não permitida'));
                }
            },
            credentials: true,
            methods: ['GET', 'POST']
        }
    });

    // 🔄 ENTERPRISE: Socket.IO Redis Adapter — multi-node horizontal scaling
    try {
        const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;
        if (redisUrl) {
            const { createAdapter } = require('@socket.io/redis-adapter');
            const { createClient } = require('redis');
            const pubClient = createClient({ url: redisUrl.startsWith('redis://') ? redisUrl : `redis://${redisUrl}` });
            const subClient = pubClient.duplicate();
            Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
                io.adapter(createAdapter(pubClient, subClient));
                console.log('🔄 Socket.IO Redis Adapter: multi-node broadcasting ativo');
            }).catch(e => {
                console.warn('⚠️  Socket.IO Redis Adapter connection failed (fallback: single-node):', e.message);
            });
        }
    } catch (adapterErr) {
        console.warn('⚠️  Socket.IO Redis Adapter indisponível (fallback: single-node):', adapterErr.message);
    }

    // Disponibilizar io globalmente
    global.io = io;

    // ⚡ SECURITY: Socket.IO JWT Authentication Middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || 
                      socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
                      socket.handshake.query?.token;
        if (!token) {
            if (process.env.NODE_ENV === 'development') return next();
            return next(new Error('Autenticação necessária'));
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            socket.user = decoded;
            next();
        } catch (err) {
            next(new Error('Token inválido ou expirado'));
        }
    });

    // Chat BOB AI handler
    try {
        const { setupChatSocket } = require('../chat/chat-handler');
        setupChatSocket(io, pool);
        console.log('💬 Chat BOB AI: Handler Socket.IO inicializado');
    } catch (chatErr) {
        console.error('⚠️  Erro ao carregar Chat handler:', chatErr.message);
    }

    // Chat Corporativo (Teams) handler
    try {
        const { setupChatTeamsSocket } = require('../routes/chat-routes');
        // Aplicar middleware de autenticação ao namespace /chat-teams
        const chatTeamsNs = io.of('/chat-teams');
        chatTeamsNs.use((socket, next) => {
            const token = socket.handshake.auth?.token || 
                          socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
                          socket.handshake.query?.token;
            if (!token) {
                if (process.env.NODE_ENV === 'development') return next();
                return next(new Error('Autenticação necessária'));
            }
            try {
                const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
                socket.user = decoded;
                next();
            } catch (err) {
                next(new Error('Token inválido ou expirado'));
            }
        });
        setupChatTeamsSocket(io, pool);
        console.log('💬 Chat Teams: Socket.IO namespace /chat-teams inicializado');
    } catch (chatTeamsErr) {
        console.error('⚠️  Erro ao carregar Chat Teams handler:', chatTeamsErr.message);
    }

    // Chat Teams — Migração automática das tabelas
    try {
        const { createChatTables } = require('../database/migrations/chat-tables');
        createChatTables(pool).then(() => {
            console.log('💬 Chat Teams: Tabelas MySQL verificadas/criadas');
        }).catch(migErr => {
            console.warn('⚠️  Chat Tables migration:', migErr.message);
        });
    } catch (chatMigErr) {
        console.warn('⚠️  Chat Tables migration load error:', chatMigErr.message);
    }

    // Socket.io — Conexões em tempo real
    io.on('connection', (socket) => {
        console.log('🔌 Cliente Socket.io conectado:', socket.id);

        socket.on('disconnect', () => {
            console.log('🔌 Cliente Socket.io desconectado:', socket.id);
        });

        socket.on('chat-message', (msg) => { io.emit('chat-message', msg); });
        socket.on('notification', (data) => { io.emit('notification', data); });

        // Chat Bob AI — transferência para humanos
        socket.on('transfer-to-human', (data) => {
            console.log('🤝 Transferência para atendente humano:', data);
            socket.broadcast.to('support-agents').emit('new-chat-transfer', {
                userId: data.userId,
                conversationHistory: data.conversationHistory,
                timestamp: new Date().toISOString()
            });
            socket.emit('transfer-confirmed', { message: 'Um atendente será conectado em breve' });
        });

        socket.on('user-message', (data) => {
            console.log('💬 Mensagem do usuário:', data);
            socket.broadcast.to('support-agents').emit('user-message-received', {
                userId: data.userId, userName: data.userName,
                message: data.message, timestamp: new Date().toISOString()
            });
        });

        // Agentes humanos
        socket.on('join-support-team', (agentData) => {
            socket.join('support-agents');
            console.log('👤 Agente entrou na equipe de suporte:', agentData);
            socket.emit('agent-connected', { status: 'online' });
        });

        socket.on('agent-typing', (data) => {
            io.emit('agent-typing', { userId: data.userId, isTyping: data.isTyping });
        });

        socket.on('agent-message', (data) => {
            console.log('📨 Mensagem do agente:', data);
            io.emit('agent-message', {
                agentName: data.agentName, message: data.message,
                timestamp: new Date().toISOString()
            });
        });

        // Gestão de estoque
        socket.on('join-stock-room', () => {
            socket.join('stock-management');
            console.log(`👤 Cliente ${socket.id} entrou na sala de gestão de estoque`);
        });

        socket.on('leave-stock-room', () => {
            socket.leave('stock-management');
            console.log(`👤 Cliente ${socket.id} saiu da sala de gestão de estoque`);
        });

        socket.on('request-products-update', () => {
            socket.emit('products-update-requested');
            console.log(`🔄 Cliente ${socket.id} solicitou atualização de produtos`);
        });
    });

    return io;
}

module.exports = { setupSocketIO };
