/**
 * Chat Handler Module - Aluforce BOB AI Chat
 * v2.0 - Com persistência MySQL
 * 
 * Integrates the Chat widget Socket.IO events into the main server
 * Conversations, messages and tickets are persisted in MySQL
 */
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { getBobResponse } = require('./bob-knowledge');

// ==================== STATE (runtime only) ====================
// Real-time connections - these are ephemeral by nature (socket-based)
const chatUsers = new Map();        // socketId -> { id, name, email, socketId }
const chatSupportAgents = new Map(); // socketId -> { name, email, socketId }

// In-memory cache for active conversations (synced with DB)
const activeConversations = new Map(); // convId -> { id, type, participants[], ... }

// MySQL pool reference (injected via setupChatSocket)
let db = null;

// ==================== DB HELPERS ====================

/**
 * Save a new conversation to MySQL
 */
async function dbSaveConversation(conv, userName, userEmail) {
    if (!db) return;
    try {
        await db.execute(
            `INSERT INTO chat_conversations (id, type, user_name, user_email, user_socket_id, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'active', NOW())`,
            [conv.id, conv.type, userName || null, userEmail || null, conv.userSocketId || null]
        );
    } catch (err) {
        console.error('❌ Chat DB: Erro ao salvar conversa:', err.message);
    }
}

/**
 * Save a message to MySQL
 */
async function dbSaveMessage(msg) {
    if (!db) return;
    try {
        await db.execute(
            `INSERT INTO chat_messages (id, conversation_id, sender, sender_name, type, content, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                msg.id,
                msg.conversationId,
                msg.sender,
                msg.senderName || 'Anônimo',
                msg.type || 'text',
                msg.content || '',
                msg.metadata ? JSON.stringify(msg.metadata) : null
            ]
        );
    } catch (err) {
        console.error('❌ Chat DB: Erro ao salvar mensagem:', err.message);
    }
}

/**
 * Save a support ticket to MySQL
 */
async function dbSaveTicket(ticket) {
    if (!db) return;
    try {
        await db.execute(
            `INSERT INTO chat_support_tickets (id, conversation_id, user_name, user_email, reason, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [ticket.id, ticket.conversationId, ticket.userName || null, ticket.userEmail || null, ticket.reason, ticket.status]
        );
    } catch (err) {
        console.error('❌ Chat DB: Erro ao salvar ticket:', err.message);
    }
}

/**
 * Update ticket status in MySQL
 */
async function dbUpdateTicketStatus(ticketId, status, agentName) {
    if (!db) return;
    try {
        const timeField = status === 'active' ? 'accepted_at' : status === 'closed' ? 'closed_at' : null;
        if (timeField) {
            await db.execute(
                `UPDATE chat_support_tickets SET status = ?, agent_name = ?, ${timeField} = NOW() WHERE id = ?`,
                [status, agentName || null, ticketId]
            );
        } else {
            await db.execute(
                `UPDATE chat_support_tickets SET status = ?, agent_name = ? WHERE id = ?`,
                [status, agentName || null, ticketId]
            );
        }
    } catch (err) {
        console.error('❌ Chat DB: Erro ao atualizar ticket:', err.message);
    }
}

/**
 * Update conversation type in MySQL
 */
async function dbUpdateConversationType(convId, type) {
    if (!db) return;
    try {
        await db.execute(
            `UPDATE chat_conversations SET type = ? WHERE id = ?`,
            [type, convId]
        );
    } catch (err) {
        console.error('❌ Chat DB: Erro ao atualizar conversa:', err.message);
    }
}

/**
 * Close conversation in MySQL
 */
async function dbCloseConversation(convId) {
    if (!db) return;
    try {
        await db.execute(
            `UPDATE chat_conversations SET status = 'closed', closed_at = NOW() WHERE id = ?`,
            [convId]
        );
    } catch (err) {
        console.error('❌ Chat DB: Erro ao fechar conversa:', err.message);
    }
}

/**
 * Load waiting tickets from MySQL (for agent reconnection)
 */
async function dbLoadWaitingTickets() {
    if (!db) return [];
    try {
        const [rows] = await db.execute(
            `SELECT t.*, c.user_name, c.user_email 
             FROM chat_support_tickets t 
             LEFT JOIN chat_conversations c ON t.conversation_id = c.id
             WHERE t.status = 'waiting' 
             ORDER BY t.created_at ASC`
        );
        return rows;
    } catch (err) {
        console.error('❌ Chat DB: Erro ao carregar tickets:', err.message);
        return [];
    }
}

/**
 * Load conversation history from MySQL
 */
async function dbLoadConversationMessages(conversationId, limit = 50) {
    if (!db) return [];
    try {
        const [rows] = await db.execute(
            `SELECT id, conversation_id AS conversationId, sender, sender_name AS senderName, 
                    type, content, metadata, created_at AS timestamp
             FROM chat_messages 
             WHERE conversation_id = ? 
             ORDER BY created_at ASC 
             LIMIT ?`,
            [conversationId, limit]
        );
        return rows.map(r => ({
            ...r,
            metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {}
        }));
    } catch (err) {
        console.error('❌ Chat DB: Erro ao carregar mensagens:', err.message);
        return [];
    }
}

/**
 * Close all orphaned open conversations (cleanup on startup)
 */
async function dbCloseOrphanedConversations() {
    if (!db) return;
    try {
        const [result] = await db.execute(
            `UPDATE chat_conversations SET status = 'closed', closed_at = NOW() WHERE status = 'active'`
        );
        if (result.affectedRows > 0) {
            console.log(`🧹 Chat DB: ${result.affectedRows} conversas órfãs fechadas`);
        }
        const [result2] = await db.execute(
            `UPDATE chat_support_tickets SET status = 'closed', closed_at = NOW() WHERE status = 'waiting'`
        );
        if (result2.affectedRows > 0) {
            console.log(`🧹 Chat DB: ${result2.affectedRows} tickets órfãos fechados`);
        }
    } catch (err) {
        console.error('❌ Chat DB: Erro ao limpar conversas órfãs:', err.message);
    }
}

// ==================== SETUP ====================
function setupChatSocket(io, mysqlPool) {
    // Store pool reference
    db = mysqlPool || null;

    if (db) {
        console.log('💾 Chat BOB AI: Persistência MySQL ATIVADA');
        // Cleanup orphaned conversations from previous sessions
        dbCloseOrphanedConversations();
    } else {
        console.log('⚠️  Chat BOB AI: Sem MySQL - modo memória apenas');
    }

    io.on('connection', (socket) => {

        // ========== USER REGISTER ==========
        socket.on('user:register', async (data) => {
            if (!data || !data.name) return;
            const userId = uuidv4();
            const user = { id: userId, name: data.name, email: data.email || null, socketId: socket.id };
            chatUsers.set(socket.id, user);

            // Create bot conversation
            const convId = uuidv4();
            const conversation = {
                id: convId,
                type: 'bot',
                participants: [socket.id, 'bob'],
                userSocketId: socket.id,
                createdAt: new Date()
            };
            activeConversations.set(convId, conversation);

            // Persist conversation to MySQL
            await dbSaveConversation(conversation, data.name, data.email);

            socket.emit('user:registered', { userId, conversationId: convId, user });

            // Welcome message
            const welcomeMsg = {
                id: uuidv4(),
                sender: 'bob',
                senderName: 'BOB',
                type: 'text',
                content: `Olá, **${data.name}**! 👋\n\nSou o **BOB**, assistente virtual da Aluforce.\n\nPosso te ajudar com:\n• 📦 **Vendas** — pedidos, orçamentos, clientes\n• 📄 **NF-e** — emissão, cancelamento, consulta\n• 💰 **Financeiro** — contas, fluxo de caixa\n• 📊 **Estoque** — consultas, movimentações\n• 👥 **RH** — folha, ponto, funcionários\n• ⚙️ **Configurações** — do sistema\n\nDigite sua dúvida ou clique em um dos tópicos! 😊`,
                timestamp: new Date(),
                conversationId: convId
            };

            // Persist welcome message
            await dbSaveMessage(welcomeMsg);

            socket.emit('message:received', welcomeMsg);
            console.log(`💬 Chat: Usuário "${data.name}" registrado (${userId})`);
        });

        // ========== SUPPORT AGENT REGISTER ==========
        socket.on('support:register', async (data) => {
            chatSupportAgents.set(socket.id, { ...data, socketId: socket.id });
            socket.join('support-room');

            // Load waiting tickets from DB instead of memory
            const waitingTickets = await dbLoadWaitingTickets();
            socket.emit('support:registered', { queue: waitingTickets });
            console.log(`🎧 Chat: Agente de suporte registrado (${waitingTickets.length} tickets na fila)`);
        });

        // ========== MESSAGE SEND ==========
        socket.on('message:send', async (data) => {
            if (!data || !data.conversationId) return;
            const conv = activeConversations.get(data.conversationId);
            if (!conv) return;

            const msg = {
                id: uuidv4(),
                sender: socket.id,
                senderName: chatUsers.get(socket.id)?.name || 'Anônimo',
                type: data.type || 'text',
                content: data.content,
                metadata: data.metadata || {},
                timestamp: new Date(),
                conversationId: data.conversationId
            };

            // Persist message to MySQL
            await dbSaveMessage(msg);

            // Relay to other participants
            conv.participants.forEach(p => {
                if (p !== socket.id && p !== 'bob') {
                    io.to(p).emit('message:received', msg);
                }
            });

            // Confirm to sender
            socket.emit('message:sent', { id: msg.id, conversationId: data.conversationId });

            // BOB AI response for bot conversations
            if (conv.type === 'bot' && (data.type === 'text' || !data.type)) {
                handleBobResponse(data.conversationId, msg, socket, io);
            }
        });

        // ========== AUDIO SEND ==========
        socket.on('audio:send', async (data) => {
            if (!data || !data.conversationId) return;
            const conv = activeConversations.get(data.conversationId);
            if (!conv) return;

            const msg = {
                id: uuidv4(),
                sender: socket.id,
                senderName: chatUsers.get(socket.id)?.name || 'Anônimo',
                type: 'audio',
                content: data.audioUrl,
                metadata: { duration: data.duration },
                timestamp: new Date(),
                conversationId: data.conversationId
            };

            // Persist audio message
            await dbSaveMessage(msg);

            conv.participants.forEach(p => {
                if (p !== socket.id && p !== 'bob') {
                    io.to(p).emit('message:received', msg);
                }
            });

            socket.emit('message:sent', { id: msg.id, conversationId: data.conversationId });

            if (conv.type === 'bot') {
                handleBobAudioResponse(data.conversationId, msg, socket, io);
            }
        });

        // ========== SUPPORT REQUEST ==========
        socket.on('support:request', async (data) => {
            const user = chatUsers.get(socket.id);
            const ticket = {
                id: uuidv4(),
                userId: user?.id,
                userName: user?.name,
                userEmail: user?.email,
                userSocketId: socket.id,
                conversationId: data?.conversationId,
                reason: data?.reason || 'Solicitação de suporte',
                status: 'waiting',
                createdAt: new Date()
            };

            // Persist ticket to MySQL
            await dbSaveTicket(ticket);

            // Count waiting from DB for accurate position
            let waitingCount = 1;
            if (db) {
                try {
                    const [rows] = await db.execute(
                        `SELECT COUNT(*) AS cnt FROM chat_support_tickets WHERE status = 'waiting'`
                    );
                    waitingCount = rows[0].cnt;
                } catch (e) {
                    waitingCount = 1;
                }
            }

            socket.emit('support:queued', { position: waitingCount, ticket });
            io.to('support-room').emit('support:new-ticket', ticket);
            console.log(`📋 Chat: Novo ticket de suporte de "${user?.name}" (posição ${waitingCount})`);
        });

        // ========== SUPPORT ACCEPT ==========
        socket.on('support:accept', async (data) => {
            if (!data || !data.ticketId) return;

            // Find ticket in DB
            let ticket = null;
            if (db) {
                try {
                    const [rows] = await db.execute(
                        `SELECT * FROM chat_support_tickets WHERE id = ? AND status = 'waiting'`,
                        [data.ticketId]
                    );
                    if (rows.length > 0) ticket = rows[0];
                } catch (e) {
                    console.error('❌ Chat DB: Erro ao buscar ticket:', e.message);
                    return;
                }
            }
            if (!ticket) return;

            const agentName = chatSupportAgents.get(socket.id)?.name || 'Atendente';

            // Update ticket in DB
            await dbUpdateTicketStatus(ticket.id, 'active', agentName);

            const convId = ticket.conversation_id || ticket.conversationId;
            const conv = activeConversations.get(convId);
            if (conv) {
                conv.type = 'support';
                if (!conv.participants.includes(socket.id)) {
                    conv.participants.push(socket.id);
                }

                // Update conversation type in DB
                await dbUpdateConversationType(conv.id, 'support');

                const systemMsg = {
                    id: uuidv4(),
                    sender: 'system',
                    senderName: 'Sistema',
                    type: 'system',
                    content: `🎉 ${agentName} entrou na conversa!`,
                    timestamp: new Date(),
                    conversationId: conv.id
                };

                // Persist system message
                await dbSaveMessage(systemMsg);

                const userSocketId = ticket.user_socket_id || ticket.userSocketId;
                io.to(userSocketId).emit('support:connected', { agentName, ticket });
                io.to(userSocketId).emit('message:received', systemMsg);
            }

            // Load full conversation history for the agent
            const conversationHistory = await dbLoadConversationMessages(convId, 100);

            socket.emit('support:accepted', { ticket: { ...ticket, agentName, status: 'active' }, conversationHistory });
            console.log(`✅ Chat: Ticket ${ticket.id} aceito por "${agentName}"`);
        });

        // ========== TYPING ==========
        socket.on('typing:start', (data) => {
            if (!data?.conversationId) return;
            const conv = activeConversations.get(data.conversationId);
            if (!conv) return;
            conv.participants.forEach(p => {
                if (p !== socket.id && p !== 'bob') {
                    io.to(p).emit('typing:update', {
                        conversationId: data.conversationId,
                        isTyping: true,
                        userName: chatUsers.get(socket.id)?.name
                    });
                }
            });
        });

        socket.on('typing:stop', (data) => {
            if (!data?.conversationId) return;
            const conv = activeConversations.get(data.conversationId);
            if (!conv) return;
            conv.participants.forEach(p => {
                if (p !== socket.id && p !== 'bob') {
                    io.to(p).emit('typing:update', {
                        conversationId: data.conversationId,
                        isTyping: false
                    });
                }
            });
        });

        // ========== DISCONNECT ==========
        socket.on('disconnect', async () => {
            const user = chatUsers.get(socket.id);
            chatUsers.delete(socket.id);
            chatSupportAgents.delete(socket.id);

            // Close conversations and notify participants
            for (const [convId, conv] of activeConversations) {
                const idx = conv.participants.indexOf(socket.id);
                if (idx !== -1) {
                    conv.participants.splice(idx, 1);

                    if (conv.type === 'support' && user) {
                        const disconnectMsg = {
                            id: uuidv4(),
                            sender: 'system',
                            senderName: 'Sistema',
                            type: 'system',
                            content: `${user.name || 'Usuário'} saiu da conversa`,
                            timestamp: new Date(),
                            conversationId: convId
                        };
                        await dbSaveMessage(disconnectMsg);

                        conv.participants.forEach(p => {
                            if (p !== 'bob') {
                                io.to(p).emit('message:received', disconnectMsg);
                            }
                        });
                    }

                    // If only 'bob' left (or empty), close conversation
                    const realParticipants = conv.participants.filter(p => p !== 'bob');
                    if (realParticipants.length === 0) {
                        await dbCloseConversation(convId);
                        activeConversations.delete(convId);
                    }
                }
            }
        });
    });

    console.log('💬 Chat BOB AI: Socket.IO handlers registrados com sucesso');
}

// ==================== BOB AI RESPONSE ====================
async function handleBobResponse(conversationId, userMsg, socket, io) {
    const conv = activeConversations.get(conversationId);
    if (!conv) return;

    const text = (userMsg.content || '').toLowerCase();

    // Check for transfer keywords
    const transferKeywords = ['atendente', 'humano', 'pessoa', 'falar com alguém', 'suporte humano', 'atendimento humano', 'falar com atendente', 'quero falar com'];
    if (transferKeywords.some(kw => text.includes(kw))) {
        socket.emit('support:suggest');
        return;
    }

    // Get BOB response
    const bobResult = getBobResponse(userMsg.content || '');
    const responseText = (typeof bobResult === 'object' && bobResult !== null && bobResult.answer) ? bobResult.answer : String(bobResult);

    // Simulate typing
    socket.emit('typing:update', { conversationId, isTyping: true, userName: 'BOB' });

    const delay = Math.min(Math.max(responseText.length * 15, 800), 3000);
    setTimeout(async () => {
        socket.emit('typing:update', { conversationId, isTyping: false });

        const bobMsg = {
            id: uuidv4(),
            sender: 'bob',
            senderName: 'BOB',
            type: 'text',
            content: responseText,
            timestamp: new Date(),
            conversationId
        };

        // Persist BOB response
        await dbSaveMessage(bobMsg);

        socket.emit('message:received', bobMsg);

        // Auto-suggest support after 3 consecutive "not found" responses
        let shouldSuggest = false;
        if (db) {
            try {
                const [rows] = await db.execute(
                    `SELECT content FROM chat_messages 
                     WHERE conversation_id = ? AND sender = 'bob' 
                     ORDER BY created_at DESC LIMIT 3`,
                    [conversationId]
                );
                if (rows.length >= 3 && rows.every(m =>
                    m.content.includes('não encontrei') || m.content.includes('Hmm') || m.content.includes('não tenho')
                )) {
                    shouldSuggest = true;
                }
            } catch (e) { /* ignore */ }
        }

        if (shouldSuggest) {
            setTimeout(() => {
                socket.emit('support:auto-transfer');
            }, 1000);
        }
    }, delay);
}

async function handleBobAudioResponse(conversationId, audioMsg, socket, io) {
    const conv = activeConversations.get(conversationId);
    if (!conv) return;

    // Context from recent messages (from DB if available)
    let context = 'áudio recebido';
    if (db) {
        try {
            const [rows] = await db.execute(
                `SELECT content FROM chat_messages 
                 WHERE conversation_id = ? AND type = 'text' AND sender != 'bob' AND sender != 'system'
                 ORDER BY created_at DESC LIMIT 3`,
                [conversationId]
            );
            if (rows.length > 0) {
                context = rows.map(r => r.content).join(' ');
            }
        } catch (e) { /* fallback to default */ }
    }

    const bobResult2 = getBobResponse(context);
    const responseText = (typeof bobResult2 === 'object' && bobResult2 !== null && bobResult2.answer) ? bobResult2.answer : String(bobResult2);

    socket.emit('typing:update', { conversationId, isTyping: true, userName: 'BOB' });

    setTimeout(async () => {
        socket.emit('typing:update', { conversationId, isTyping: false });

        const bobMsg = {
            id: uuidv4(),
            sender: 'bob',
            senderName: 'BOB',
            type: 'text',
            content: `🎵 Recebi seu áudio! No momento, só consigo processar mensagens de texto. Mas vou tentar ajudar baseado no contexto:\n\n${responseText}`,
            timestamp: new Date(),
            conversationId
        };

        // Persist BOB audio response
        await dbSaveMessage(bobMsg);

        socket.emit('message:received', bobMsg);
    }, 1500);
}

// ==================== HELPERS ====================
function getOnlineUsers() {
    return Array.from(chatUsers.values()).map(u => ({
        id: u.id,
        name: u.name
    }));
}

module.exports = { setupChatSocket, getOnlineUsers };
