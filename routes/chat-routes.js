/**
 * CHAT CORPORATIVO (Teams) — Rotas API + Socket.IO Handler
 * 
 * Integrado ao sistema ALUFORCE:
 * - Usa tabela `usuarios` existente (sem duplicação de usuários)
 * - Autenticação via JWT (authenticateToken)
 * - Socket.IO compartilhado com o servidor principal
 * - Armazena mensagens no MySQL (chat_canais, chat_mensagens_canal, chat_mensagens_diretas)
 * 
 * Funcionalidades:
 * - Canais de grupo (#geral, #ti, #rh, etc.)
 * - Mensagens diretas entre usuários
 * - Presença online em tempo real
 * - Indicador de digitação
 * - Bot BOB I.A. (TI)
 * - Status de presença (online, em almoço, em reunião, offline)
 * - Suporte a arquivos, imagens e áudio
 * 
 * @module routes/chat-routes
 */

const AVATAR_COLORS = ['#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#2563EB'];

// Helper: extrair apenas o primeiro nome
function firstName(fullName) {
    if (!fullName) return 'Usuário';
    return fullName.trim().split(/\s+/)[0];
}

// ── Estado em memória ─────────────────────────────────────
const onlineUsers = new Map(); // userId -> { socketId, user }
const userStatuses = new Map(); // userId -> 'online'|'almoco'|'reuniao'|'offline'

module.exports = function registerChatRoutes(app, deps) {
    const { pool, authenticateToken } = deps;

    // ═══════════════════════════════════════════════════════
    // REST API
    // ═══════════════════════════════════════════════════════

    /**
     * GET /api/chat/usuarios — Lista todos os usuários para o chat
     * Retorna usuários da tabela `usuarios` com campos necessários para o chat
     */
    app.get('/api/chat/usuarios', authenticateToken, async (req, res) => {
        try {
            // Tentar buscar com coluna departamento; fallback sem ela
            let rows;
            try {
                [rows] = await pool.query(`
                    SELECT id, nome, apelido, email, foto, avatar, role,
                           COALESCE(departamento, role, 'Geral') as departamento
                    FROM usuarios
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome ASC
                `);
            } catch (colErr) {
                // Se coluna departamento não existir, buscar sem ela
                [rows] = await pool.query(`
                    SELECT id, nome, apelido, email, foto, avatar, role,
                           COALESCE(role, 'Geral') as departamento
                    FROM usuarios
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome ASC
                `);
            }

            const users = rows.map(u => ({
                id: u.id,
                displayName: firstName(u.apelido || u.nome) || u.email.split('@')[0],
                fullName: u.apelido || u.nome || u.email.split('@')[0],
                email: u.email,
                department: u.departamento || 'Geral',
                avatarColor: AVATAR_COLORS[u.id % AVATAR_COLORS.length],
                foto: u.foto || u.avatar || null,
                role: u.role,
                isBot: false
            }));

            // Adicionar bot BOB I.A.
            users.unshift({
                id: -1,
                displayName: 'BOB I.A.',
                fullName: 'BOB I.A.',
                email: 'bot@aluforce.com',
                department: 'TI',
                avatarColor: '#A855F7',
                foto: '/chat-teams/BobAI.png',
                role: 'bot',
                isBot: true
            });

            res.json(users);
        } catch (err) {
            console.error('[CHAT] Erro ao listar usuários:', err.message);
            res.status(500).json({ error: 'Erro ao listar usuários' });
        }
    });

    /**
     * GET /api/chat/contatos — Lista IDs de usuários com conversa existente
     * Retorna apenas IDs dos usuários que já trocaram DM com o usuário logado
     */
    app.get('/api/chat/contatos', authenticateToken, async (req, res) => {
        try {
            const myId = req.user.id;
            const [rows] = await pool.query(`
                SELECT DISTINCT
                    CASE WHEN de_usuario_id = ? THEN para_usuario_id ELSE de_usuario_id END as contact_id
                FROM chat_mensagens_diretas
                WHERE de_usuario_id = ? OR para_usuario_id = ?
            `, [myId, myId, myId]);
            const contactIds = rows.map(r => r.contact_id);
            res.json(contactIds);
        } catch (err) {
            console.error('[CHAT] Erro ao listar contatos:', err.message);
            res.json([]);
        }
    });

    /**
     * GET /api/chat/canais — Lista canais (filtrado por departamento do usuário)
     */
    app.get('/api/chat/canais', authenticateToken, async (req, res) => {
        try {
            let rows;
            try {
                [rows] = await pool.query(`
                    SELECT id, nome, descricao, departamento, somente_admin FROM chat_canais
                    WHERE ativo = 1
                    ORDER BY nome ASC
                `);
            } catch (colErr) {
                [rows] = await pool.query(`
                    SELECT id, nome, descricao FROM chat_canais
                    WHERE ativo = 1
                    ORDER BY nome ASC
                `);
                // add defaults
                rows = rows.map(r => ({ ...r, departamento: 'todos', somente_admin: 0 }));
            }

            // Filter by user department (admins see all)
            const userRole = (req.user.role || '').toLowerCase();
            const isAdmin = userRole === 'admin' || userRole === 'administrador';
            if (!isAdmin) {
                let userDept = '';
                try {
                    const [uRows] = await pool.query(
                        'SELECT COALESCE(departamento, role, \'Geral\') as departamento FROM usuarios WHERE id = ?', [req.user.id]
                    );
                    userDept = (uRows[0]?.departamento || '').toLowerCase();
                } catch(e) { userDept = (req.user.role || '').toLowerCase(); }

                rows = rows.filter(ch => {
                    if (!ch.departamento || ch.departamento === 'todos') return true;
                    if (ch.nome === 'geral') return true;
                    return ch.departamento.toLowerCase() === userDept;
                });
            }

            res.json(rows);
        } catch (err) {
            console.error('[CHAT] Erro ao listar canais:', err.message);
            res.status(500).json({ error: 'Erro ao listar canais' });
        }
    });

    /**
     * POST /api/chat/canais — Cria um novo canal (com departamento e somente_admin)
     */
    app.post('/api/chat/canais', authenticateToken, async (req, res) => {
        try {
            const { nome, descricao, departamento, somente_admin } = req.body;
            const cleanName = (nome || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (!cleanName) return res.status(400).json({ error: 'Nome do canal é obrigatório' });

            // Verificar se já existe
            const [existing] = await pool.query('SELECT id FROM chat_canais WHERE nome = ?', [cleanName]);
            if (existing.length > 0) return res.status(409).json({ error: 'Canal já existe' });

            let result;
            try {
                [result] = await pool.query(
                    'INSERT INTO chat_canais (nome, descricao, criado_por, departamento, somente_admin) VALUES (?, ?, ?, ?, ?)',
                    [cleanName, descricao || '', req.user.id, departamento || 'todos', somente_admin ? 1 : 0]
                );
            } catch (colErr) {
                [result] = await pool.query(
                    'INSERT INTO chat_canais (nome, descricao, criado_por) VALUES (?, ?, ?)',
                    [cleanName, descricao || '', req.user.id]
                );
            }

            const channel = { id: result.insertId, nome: cleanName, descricao: descricao || '', departamento: departamento || 'todos', somente_admin: somente_admin ? 1 : 0 };

            // Notificar todos via Socket.IO
            if (global.io) {
                global.io.emit('chat:channel:created', channel);
            }

            res.status(201).json({ channel });
        } catch (err) {
            console.error('[CHAT] Erro ao criar canal:', err.message);
            res.status(500).json({ error: 'Erro ao criar canal' });
        }
    });

    /**
     * PUT /api/chat/canais/:id — Atualiza canal (admin only)
     */
    app.put('/api/chat/canais/:id', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user.role || '').toLowerCase();
            const isAdmin = userRole === 'admin' || userRole === 'administrador';
            if (!isAdmin) return res.status(403).json({ error: 'Somente administradores podem editar canais' });

            const channelId = parseInt(req.params.id);
            const { nome, descricao, departamento, somente_admin } = req.body;
            const cleanName = (nome || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (!cleanName) return res.status(400).json({ error: 'Nome do canal é obrigatório' });

            // Check duplicates (excluding self)
            const [dup] = await pool.query('SELECT id FROM chat_canais WHERE nome = ? AND id != ?', [cleanName, channelId]);
            if (dup.length > 0) return res.status(409).json({ error: 'Já existe outro canal com esse nome' });

            try {
                await pool.query(
                    'UPDATE chat_canais SET nome = ?, descricao = ?, departamento = ?, somente_admin = ? WHERE id = ?',
                    [cleanName, descricao || '', departamento || 'todos', somente_admin ? 1 : 0, channelId]
                );
            } catch (colErr) {
                await pool.query(
                    'UPDATE chat_canais SET nome = ?, descricao = ? WHERE id = ?',
                    [cleanName, descricao || '', channelId]
                );
            }

            const channel = { id: channelId, nome: cleanName, descricao: descricao || '', departamento: departamento || 'todos', somente_admin: somente_admin ? 1 : 0 };

            // Notify all connected clients
            if (global.io) {
                global.io.of('/chat-teams').emit('chat:channel:updated', channel);
            }

            res.json({ channel });
        } catch (err) {
            console.error('[CHAT] Erro ao atualizar canal:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar canal' });
        }
    });

    /**
     * GET /api/chat/canais/:id/mensagens — Mensagens de um canal
     */
    app.get('/api/chat/canais/:id/mensagens', authenticateToken, async (req, res) => {
        try {
            const canalId = parseInt(req.params.id);
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);

            let rows;
            try {
                [rows] = await pool.query(`
                    SELECT m.id, m.canal_id, m.usuario_id, m.conteudo, m.criado_em,
                           m.arquivo_url, m.arquivo_nome, m.arquivo_tamanho,
                           COALESCE(m.editado, 0) as editado, COALESCE(m.excluida, 0) as excluida,
                           u.nome, u.apelido, u.foto, u.avatar
                    FROM chat_mensagens_canal m
                    LEFT JOIN usuarios u ON u.id = m.usuario_id
                    WHERE m.canal_id = ? AND COALESCE(m.excluida, 0) = 0
                    ORDER BY m.criado_em ASC
                    LIMIT ?
                `, [canalId, limit]);
            } catch (colErr) {
                [rows] = await pool.query(`
                    SELECT m.id, m.canal_id, m.usuario_id, m.conteudo, m.criado_em,
                           u.nome, u.apelido, u.foto, u.avatar
                    FROM chat_mensagens_canal m
                    LEFT JOIN usuarios u ON u.id = m.usuario_id
                    WHERE m.canal_id = ?
                    ORDER BY m.criado_em ASC
                    LIMIT ?
                `, [canalId, limit]);
            }

            const messages = rows.map(r => ({
                id: r.id,
                channelId: r.canal_id,
                userId: r.usuario_id,
                content: r.conteudo,
                createdAt: r.criado_em,
                displayName: firstName(r.apelido || r.nome) || 'Desconhecido',
                avatarColor: AVATAR_COLORS[r.usuario_id % AVATAR_COLORS.length],
                foto: r.foto || r.avatar || null,
                fileUrl: r.arquivo_url || null,
                fileName: r.arquivo_nome || null,
                fileSize: r.arquivo_tamanho || null,
                editado: r.editado || 0
            }));

            res.json(messages);
        } catch (err) {
            console.error('[CHAT] Erro ao carregar mensagens do canal:', err.message);
            res.status(500).json({ error: 'Erro ao carregar mensagens' });
        }
    });

    /**
     * GET /api/chat/dm/:outroUsuarioId — Mensagens diretas com outro usuário
     */
    app.get('/api/chat/dm/:outroUsuarioId', authenticateToken, async (req, res) => {
        try {
            const myId = req.user.id;
            const otherId = parseInt(req.params.outroUsuarioId);
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);

            // Bot messages are now persisted, load them from DB like normal DMs

            let rows;
            try {
                [rows] = await pool.query(`
                    SELECT m.id, m.de_usuario_id, m.para_usuario_id, m.conteudo, m.criado_em,
                           m.arquivo_url, m.arquivo_nome, m.arquivo_tamanho,
                           COALESCE(m.editado, 0) as editado, COALESCE(m.excluida, 0) as excluida,
                           m.excluida_para,
                           u.nome, u.apelido, u.foto, u.avatar
                    FROM chat_mensagens_diretas m
                    LEFT JOIN usuarios u ON u.id = m.de_usuario_id
                    WHERE (m.de_usuario_id = ? AND m.para_usuario_id = ?)
                       OR (m.de_usuario_id = ? AND m.para_usuario_id = ?)
                    ORDER BY m.criado_em ASC
                    LIMIT ?
                `, [myId, otherId, otherId, myId, limit]);
            } catch (colErr) {
                [rows] = await pool.query(`
                    SELECT m.id, m.de_usuario_id, m.para_usuario_id, m.conteudo, m.criado_em,
                           u.nome, u.apelido, u.foto, u.avatar
                    FROM chat_mensagens_diretas m
                    LEFT JOIN usuarios u ON u.id = m.de_usuario_id
                    WHERE (m.de_usuario_id = ? AND m.para_usuario_id = ?)
                       OR (m.de_usuario_id = ? AND m.para_usuario_id = ?)
                    ORDER BY m.criado_em ASC
                    LIMIT ?
                `, [myId, otherId, otherId, myId, limit]);
            }

            // Filter out messages deleted for this user
            const filtered = rows.filter(r => {
                if (r.excluida) return false;
                if (r.excluida_para) {
                    try {
                        const delFor = typeof r.excluida_para === 'string' ? JSON.parse(r.excluida_para) : r.excluida_para;
                        if (Array.isArray(delFor) && delFor.includes(myId)) return false;
                    } catch(e) {}
                }
                return true;
            });

            const messages = filtered.map(r => ({
                id: r.id,
                fromId: r.de_usuario_id,
                toId: r.para_usuario_id,
                content: r.conteudo,
                createdAt: r.criado_em,
                displayName: r.de_usuario_id === -1 ? 'BOB I.A.' : (firstName(r.apelido || r.nome) || 'Desconhecido'),
                avatarColor: r.de_usuario_id === -1 ? '#A855F7' : AVATAR_COLORS[r.de_usuario_id % AVATAR_COLORS.length],
                foto: r.de_usuario_id === -1 ? null : (r.foto || r.avatar || null),
                isBot: r.de_usuario_id === -1,
                fileUrl: r.arquivo_url || null,
                fileName: r.arquivo_nome || null,
                fileSize: r.arquivo_tamanho || null,
                editado: r.editado || 0
            }));

            // Marcar como lidas
            await pool.query(
                'UPDATE chat_mensagens_diretas SET lida = 1 WHERE de_usuario_id = ? AND para_usuario_id = ? AND lida = 0',
                [otherId, myId]
            ).catch(() => {});

            res.json(messages);
        } catch (err) {
            console.error('[CHAT] Erro ao carregar DMs:', err.message);
            res.status(500).json({ error: 'Erro ao carregar mensagens diretas' });
        }
    });

    /**
     * GET /api/chat/nao-lidas — Contagem de mensagens não lidas para o usuário
     */
    app.get('/api/chat/nao-lidas', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT COUNT(*) as total FROM chat_mensagens_diretas WHERE para_usuario_id = ? AND lida = 0',
                [req.user.id]
            );
            res.json({ naoLidas: rows[0].total });
        } catch (err) {
            res.json({ naoLidas: 0 });
        }
    });

    console.log('[CHAT] ✅ Rotas REST registradas: /api/chat/usuarios, /api/chat/canais, /api/chat/dm, /api/chat/nao-lidas');
};

// ═══════════════════════════════════════════════════════════
// SOCKET.IO HANDLER — Eventos de Chat em Tempo Real
// ═══════════════════════════════════════════════════════════

module.exports.setupChatTeamsSocket = function setupChatTeamsSocket(io, pool) {
    // Namespace separado para evitar conflito com Socket.IO existente
    const chatNs = io.of('/chat-teams');

    chatNs.on('connection', (socket) => {
        console.log(`[CHAT] 🔌 Conectado: ${socket.id}`);

        // ── Usuário ficou online ──
        socket.on('chat:online', (user) => {
            if (!user || !user.id) return;
            socket.userId = user.id;
            onlineUsers.set(user.id, { socketId: socket.id, user });
            // Definir status inicial
            if (user.status) userStatuses.set(user.id, user.status);
            else if (!userStatuses.has(user.id)) userStatuses.set(user.id, 'online');
            chatNs.emit('chat:users:online', Array.from(onlineUsers.keys()));
            // Emitir todos os statuses
            const statusObj = {};
            userStatuses.forEach((v, k) => statusObj[k] = v);
            chatNs.emit('chat:users:statuses', statusObj);
            console.log(`[CHAT] ✅ Online: ${user.displayName} (ID ${user.id}) [${userStatuses.get(user.id)}]`);
        });

        // ── Mudança de status ──
        socket.on('chat:status', (data) => {
            if (!data || !data.userId) return;
            userStatuses.set(data.userId, data.status || 'online');
            chatNs.emit('chat:user:status', { userId: data.userId, status: data.status || 'online' });
            console.log(`[CHAT] 🔄 Status: ${data.userId} → ${data.status}`);
        });

        // ── Entrar em canal ──
        socket.on('chat:channel:join', (channelId) => {
            socket.join(`channel:${channelId}`);
        });

        // ── Sair de canal ──
        socket.on('chat:channel:leave', (channelId) => {
            socket.leave(`channel:${channelId}`);
        });

        // ── Mensagem em canal ──
        socket.on('chat:channel:message', async (data) => {
            try {
                const { channelId, userId, content, fileUrl, fileName, fileSize, fileMime } = data;
                if (!channelId || !userId || (!content && !fileUrl)) return;

                // Check admin-only channel
                try {
                    const [chRows] = await pool.query('SELECT somente_admin FROM chat_canais WHERE id = ?', [channelId]);
                    if (chRows.length && chRows[0].somente_admin) {
                        const [uRows] = await pool.query('SELECT role FROM usuarios WHERE id = ?', [userId]);
                        const uRole = (uRows[0]?.role || '').toLowerCase();
                        if (uRole !== 'admin' && uRole !== 'administrador') {
                            socket.emit('chat:error', { message: 'Somente administradores podem enviar mensagens neste canal' });
                            return;
                        }
                    }
                } catch(colErr) { /* column doesn't exist yet, allow */ }

                // Salvar no MySQL (com ou sem arquivo)
                let result;
                try {
                    [result] = await pool.query(
                        'INSERT INTO chat_mensagens_canal (canal_id, usuario_id, conteudo, arquivo_url, arquivo_nome, arquivo_tamanho) VALUES (?, ?, ?, ?, ?, ?)',
                        [channelId, userId, content || '', fileUrl || null, fileName || null, fileSize || null]
                    );
                } catch (colErr) {
                    // Fallback se colunas de arquivo não existem ainda
                    [result] = await pool.query(
                        'INSERT INTO chat_mensagens_canal (canal_id, usuario_id, conteudo) VALUES (?, ?, ?)',
                        [channelId, userId, content || '']
                    );
                }

                // Buscar nome do usuário
                const [userRows] = await pool.query(
                    'SELECT nome, apelido, foto, avatar FROM usuarios WHERE id = ?', [userId]
                );
                const user = userRows[0] || {};

                const msg = {
                    id: result.insertId,
                    channelId,
                    userId,
                    content: content || '',
                    createdAt: new Date().toISOString(),
                    displayName: firstName(user.apelido || user.nome) || 'Desconhecido',
                    avatarColor: AVATAR_COLORS[userId % AVATAR_COLORS.length],
                    foto: user.foto || user.avatar || null,
                    fileUrl: fileUrl || null,
                    fileName: fileName || null,
                    fileSize: fileSize || null
                };

                // Broadcast para todos no canal
                chatNs.to(`channel:${channelId}`).emit('chat:channel:message', msg);
                // Também enviar para o remetente (pode não estar no room ainda)
                socket.emit('chat:channel:message', msg);
            } catch (err) {
                console.error('[CHAT] Erro ao salvar mensagem de canal:', err.message);
            }
        });

        // ── Mensagem direta ──
        socket.on('chat:dm:message', async (data) => {
            try {
                const { fromId, toId, content, fileUrl, fileName, fileSize, fileMime } = data;
                if (!fromId || !toId || (!content && !fileUrl)) return;

                // Se for mensagem para o bot (-1), persistir e responder com I.A.
                if (toId === -1) {
                    // Persistir a mensagem do usuário para o bot
                    try {
                        await pool.query(
                            'INSERT INTO chat_mensagens_diretas (de_usuario_id, para_usuario_id, conteudo) VALUES (?, ?, ?)',
                            [fromId, -1, content || '']
                        );
                    } catch(e) { /* bot user -1 may not exist as FK, ignore */ }
                    handleBotMessage(socket, chatNs, pool, fromId, content || '');
                    return;
                }

                // Salvar no MySQL (com ou sem arquivo)
                let result;
                try {
                    [result] = await pool.query(
                        'INSERT INTO chat_mensagens_diretas (de_usuario_id, para_usuario_id, conteudo, arquivo_url, arquivo_nome, arquivo_tamanho) VALUES (?, ?, ?, ?, ?, ?)',
                        [fromId, toId, content || '', fileUrl || null, fileName || null, fileSize || null]
                    );
                } catch (colErr) {
                    [result] = await pool.query(
                        'INSERT INTO chat_mensagens_diretas (de_usuario_id, para_usuario_id, conteudo) VALUES (?, ?, ?)',
                        [fromId, toId, content || '']
                    );
                }

                // Buscar nome do remetente
                const [userRows] = await pool.query(
                    'SELECT nome, apelido, foto, avatar FROM usuarios WHERE id = ?', [fromId]
                );
                const user = userRows[0] || {};

                const msg = {
                    id: result.insertId,
                    fromId,
                    toId,
                    content: content || '',
                    createdAt: new Date().toISOString(),
                    displayName: firstName(user.apelido || user.nome) || 'Desconhecido',
                    avatarColor: AVATAR_COLORS[fromId % AVATAR_COLORS.length],
                    foto: user.foto || user.avatar || null,
                    fileUrl: fileUrl || null,
                    fileName: fileName || null,
                    fileSize: fileSize || null
                };

                // Enviar para remetente
                socket.emit('chat:dm:message', msg);

                // Enviar para destinatário se estiver online
                const target = onlineUsers.get(toId);
                if (target) {
                    chatNs.to(target.socketId).emit('chat:dm:message', msg);
                    // Notificação de nova mensagem
                    chatNs.to(target.socketId).emit('chat:dm:notification', {
                        fromId,
                        displayName: msg.displayName,
                        preview: content.substring(0, 50)
                    });
                }
            } catch (err) {
                console.error('[CHAT] Erro ao salvar DM:', err.message);
            }
        });

        // ── Indicador de digitação ──
        socket.on('chat:typing:start', (data) => {
            if (data.channelId) {
                socket.to(`channel:${data.channelId}`).emit('chat:typing:start', data);
            } else if (data.toId) {
                const target = onlineUsers.get(data.toId);
                if (target) chatNs.to(target.socketId).emit('chat:typing:start', data);
            }
        });

        socket.on('chat:typing:stop', (data) => {
            if (data.channelId) {
                socket.to(`channel:${data.channelId}`).emit('chat:typing:stop', data);
            } else if (data.toId) {
                const target = onlineUsers.get(data.toId);
                if (target) chatNs.to(target.socketId).emit('chat:typing:stop', data);
            }
        });

        // ── Editar mensagem ──
        socket.on('chat:message:edit', async (data) => {
            try {
                const { msgId, msgType, newContent, userId } = data;
                if (!msgId || !newContent || !userId) return;

                const table = msgType === 'channel' ? 'chat_mensagens_canal' : 'chat_mensagens_diretas';
                const userCol = msgType === 'channel' ? 'usuario_id' : 'de_usuario_id';

                // Verify ownership
                const [rows] = await pool.query(`SELECT ${userCol} as uid, canal_id FROM ${table} WHERE id = ?`, [msgId]);
                if (!rows.length || rows[0].uid !== userId) {
                    socket.emit('chat:error', { message: 'Você só pode editar suas próprias mensagens' });
                    return;
                }

                // Update message
                try {
                    await pool.query(`UPDATE ${table} SET conteudo = ?, editado = 1, editado_em = NOW() WHERE id = ?`, [newContent, msgId]);
                } catch(colErr) {
                    await pool.query(`UPDATE ${table} SET conteudo = ? WHERE id = ?`, [newContent, msgId]);
                }

                const editedData = { msgId, msgType, newContent, userId };

                if (msgType === 'channel' && rows[0].canal_id) {
                    chatNs.to(`channel:${rows[0].canal_id}`).emit('chat:message:edited', editedData);
                    socket.emit('chat:message:edited', editedData);
                } else {
                    // DM - notify both parties
                    socket.emit('chat:message:edited', editedData);
                    // Find the other user in the DM
                    const [dmRow] = await pool.query(`SELECT de_usuario_id, para_usuario_id FROM ${table} WHERE id = ?`, [msgId]);
                    if (dmRow.length) {
                        const otherId = dmRow[0].de_usuario_id === userId ? dmRow[0].para_usuario_id : dmRow[0].de_usuario_id;
                        const target = onlineUsers.get(otherId);
                        if (target) chatNs.to(target.socketId).emit('chat:message:edited', editedData);
                    }
                }

                console.log(`[CHAT] ✏️ Mensagem ${msgId} editada por user ${userId}`);
            } catch (err) {
                console.error('[CHAT] Erro ao editar mensagem:', err.message);
            }
        });

        // ── Excluir mensagem ──
        socket.on('chat:message:delete', async (data) => {
            try {
                const { msgId, msgType, userId, scope } = data;
                if (!msgId || !userId) return;

                const table = msgType === 'channel' ? 'chat_mensagens_canal' : 'chat_mensagens_diretas';
                const userCol = msgType === 'channel' ? 'usuario_id' : 'de_usuario_id';

                // Verify ownership
                const [rows] = await pool.query(`SELECT ${userCol} as uid, canal_id FROM ${table} WHERE id = ?`, [msgId]);
                if (!rows.length || rows[0].uid !== userId) {
                    socket.emit('chat:error', { message: 'Você só pode excluir suas próprias mensagens' });
                    return;
                }

                if (scope === 'all') {
                    // Excluir para todos - soft delete
                    try {
                        await pool.query(`UPDATE ${table} SET excluida = 1 WHERE id = ?`, [msgId]);
                    } catch(colErr) {
                        await pool.query(`DELETE FROM ${table} WHERE id = ?`, [msgId]);
                    }

                    const deleteData = { msgId, msgType, scope: 'all' };
                    if (msgType === 'channel' && rows[0].canal_id) {
                        chatNs.to(`channel:${rows[0].canal_id}`).emit('chat:message:deleted', deleteData);
                        socket.emit('chat:message:deleted', deleteData);
                    } else {
                        socket.emit('chat:message:deleted', deleteData);
                        const [dmRow] = await pool.query(`SELECT de_usuario_id, para_usuario_id FROM ${table} WHERE id = ?`, [msgId]);
                        if (dmRow.length) {
                            const otherId = dmRow[0].de_usuario_id === userId ? dmRow[0].para_usuario_id : dmRow[0].de_usuario_id;
                            const target = onlineUsers.get(otherId);
                            if (target) chatNs.to(target.socketId).emit('chat:message:deleted', deleteData);
                        }
                    }
                    console.log(`[CHAT] 🗑️ Mensagem ${msgId} excluída para todos por user ${userId}`);
                } else {
                    // Apagar para mim only (DMs only)
                    if (msgType === 'dm') {
                        try {
                            // Get current excluida_para
                            const [epRows] = await pool.query(`SELECT excluida_para FROM ${table} WHERE id = ?`, [msgId]);
                            let delFor = [];
                            if (epRows.length && epRows[0].excluida_para) {
                                try { delFor = JSON.parse(epRows[0].excluida_para); } catch(e) { delFor = []; }
                            }
                            if (!delFor.includes(userId)) delFor.push(userId);
                            await pool.query(`UPDATE ${table} SET excluida_para = ? WHERE id = ?`, [JSON.stringify(delFor), msgId]);
                        } catch(colErr) {
                            // Column doesn't exist yet, just soft delete
                            await pool.query(`DELETE FROM ${table} WHERE id = ?`, [msgId]);
                        }
                        socket.emit('chat:message:deleted', { msgId, msgType, scope: 'me' });
                    } else {
                        // In channels, "delete for me" acts like delete for all (since it's a group)
                        try {
                            await pool.query(`UPDATE ${table} SET excluida = 1 WHERE id = ?`, [msgId]);
                        } catch(colErr) {
                            await pool.query(`DELETE FROM ${table} WHERE id = ?`, [msgId]);
                        }
                        const deleteData = { msgId, msgType, scope: 'all' };
                        chatNs.to(`channel:${rows[0].canal_id}`).emit('chat:message:deleted', deleteData);
                        socket.emit('chat:message:deleted', deleteData);
                    }
                    console.log(`[CHAT] 🗑️ Mensagem ${msgId} apagada para user ${userId}`);
                }
            } catch (err) {
                console.error('[CHAT] Erro ao excluir mensagem:', err.message);
            }
        });

        // ── Desconexão ──
        socket.on('disconnect', () => {
            if (socket.userId) {
                onlineUsers.delete(socket.userId);
                userStatuses.set(socket.userId, 'offline');
                chatNs.emit('chat:users:online', Array.from(onlineUsers.keys()));
                chatNs.emit('chat:user:status', { userId: socket.userId, status: 'offline' });
            }
            console.log(`[CHAT] ❌ Desconectado: ${socket.id}`);
        });
    });

    console.log('[CHAT] ✅ Socket.IO namespace /chat-teams inicializado');
};

// ═══════════════════════════════════════════════════════════
// BOT I.A. DE SUPORTE — Base de Conhecimento ALUFORCE
// ═══════════════════════════════════════════════════════════

// Base de conhecimento completa extraída da Central de Ajuda
const BOB_KNOWLEDGE_BASE = {

    // ── PRIMEIRO ACESSO / GUIA INICIAL ──
    primeiroAcesso: {
        keywords: /primeiro acesso|primeira vez|como acessar|credenciais|login.*primeiro|como entrar|acabei de contratar|comecar|começar|novo.*usuario|novo.*usu[aá]rio|como.*começo|iniciar.*sistema/i,
        response: `📋 **Primeiro Acesso ao Aluforce**

1. Acesse o portal pelo link enviado por e-mail
2. Use as credenciais temporárias (usuário e senha)
3. No primeiro login, crie uma nova senha
4. Complete seu cadastro pessoal

**Requisitos:**
• Navegador: Chrome, Firefox, Edge ou Safari (atualizado)
• Internet banda larga estável
• Resolução mínima: 1024x768

**Interface:**
• **Menu lateral** — acesso a todos os módulos
• **Dashboard** — visão geral dos indicadores
• **Barra de pesquisa** — busca rápida
• **Notificações** — atualizações importantes

📖 [Ver tutorial completo](https://zyntraerp.com.br/ajuda/artigos/primeiro-acesso.html)`
    },

    configuracoes: {
        keywords: /configura[çc][oõ]|configurar|dados.*empresa|configura[çc][oõ]es iniciais|segmento/i,
        response: `⚙️ **Configurações Iniciais**

Após o primeiro acesso, configure:

1. **Dados da Empresa** — CNPJ, razão social, endereço
2. **Configurações por Segmento** — ajustes específicos para seu ramo
3. **Usuários e Permissões** — quem acessa o quê
4. **Certificado Digital** — para emissão de NF-e

📖 [Configurações Iniciais](https://zyntraerp.com.br/ajuda/artigos/configuracoes-iniciais.html)
📖 [Configurações por Segmento](https://zyntraerp.com.br/ajuda/artigos/configuracoes-segmento.html)`
    },

    // ── VENDAS ──
    vendas: {
        keywords: /pedido.*venda|vender|vendas|criar.*pedido|novo.*pedido|como.*vend|modulo.*venda|kanban.*venda/i,
        response: `🛒 **Módulo de Vendas**

**Como criar um pedido de venda:**
1. Acesse **Vendas** no menu lateral (ícone 🛒)
2. Clique na aba **"Pedidos"**
3. Clique em **"Incluir"** (+) no painel lateral
4. Selecione o **cliente** (nome ou CNPJ)
5. Adicione os **produtos** (código ou descrição)
6. Defina a **condição de pagamento** (30/60/90, à vista, etc.)
7. Configure o **frete** (CIF ou FOB) e transportadora
8. Clique em **"Salvar Pedido"**

**Status do pedido:**
• Rascunho → Pendente → Aprovado → Em Produção → Faturado → Entregue

📖 [Tutorial: Criar Pedido](https://zyntraerp.com.br/ajuda/artigos/tutorial-novo-pedido-venda.html)
📖 [Duplicar Pedido](https://zyntraerp.com.br/ajuda/artigos/tutorial-duplicar-pedido.html)
📖 [Gerar Orçamento](https://zyntraerp.com.br/ajuda/artigos/tutorial-gerar-orcamento.html)`
    },

    orcamento: {
        keywords: /or[çc]amento|gerar.*or[çc]amento|proposta|proposta.*comercial/i,
        response: `📄 **Gerar Orçamento**

O Aluforce permite gerar orçamentos a partir de pedidos:
1. Crie um pedido de venda normalmente
2. Selecione a opção **"Gerar Orçamento"**
3. O sistema gera um PDF formatado para o cliente
4. Envie por e-mail diretamente pelo sistema

📖 [Tutorial: Gerar Orçamento](https://zyntraerp.com.br/ajuda/artigos/tutorial-gerar-orcamento.html)
📖 [Exportar Pedido em PDF](https://zyntraerp.com.br/ajuda/artigos/tutorial-exportar-pedido-pdf.html)`
    },

    comissoes: {
        keywords: /comiss[aãõ]|comissao|comissões|acompanhar.*comiss/i,
        response: `💰 **Comissões de Vendas**

Acompanhe suas comissões no módulo de Vendas:
1. Acesse **Vendas → Comissões**
2. Filtre por período, vendedor ou status
3. Veja o total de comissões a receber
4. Exporte relatórios detalhados

📖 [Tutorial: Acompanhar Comissões](https://zyntraerp.com.br/ajuda/artigos/tutorial-acompanhar-comissoes.html)`
    },

    prospeccao: {
        keywords: /prospec[çc][aã]o|b2b|prospectar|leads|lead|captar.*cliente/i,
        response: `🎯 **Prospecção B2B**

Use a prospecção inteligente do Aluforce:
1. Acesse **Vendas → Prospecções**
2. Busque empresas por segmento, região ou porte
3. Converta prospecções em clientes e pedidos

📖 [Tutorial: Prospecção B2B](https://zyntraerp.com.br/ajuda/artigos/tutorial-prospeccao-b2b.html)`
    },

    tabelaPrecos: {
        keywords: /tabela.*pre[çc]o|preco.*diferenciado|pre[çc]o.*especial|markup|margem/i,
        response: `💲 **Tabela de Preços**

Configure preços diferenciados:
1. Acesse **Vendas → Tabela de Preços**
2. Crie tabelas por tipo de cliente, região ou volume
3. Vincule tabelas aos clientes automaticamente

📖 [Tabela de Preços](https://zyntraerp.com.br/ajuda/artigos/tabela-precos.html)`
    },

    duplicarPedido: {
        keywords: /duplicar.*pedido|copiar.*pedido|pedido.*semelhante|replicar.*pedido/i,
        response: `📋 **Duplicar Pedido**

Para criar pedidos semelhantes rapidamente:
1. Abra o pedido que deseja duplicar
2. Clique em **"Duplicar"** no painel de ações
3. Altere cliente, itens ou condições conforme necessário
4. Salve o novo pedido

📖 [Tutorial: Duplicar Pedido](https://zyntraerp.com.br/ajuda/artigos/tutorial-duplicar-pedido.html)`
    },

    exportarPdf: {
        keywords: /exportar.*pdf|pdf.*pedido|gerar.*pdf|imprimir.*pedido|baixar.*pedido/i,
        response: `📥 **Exportar Pedido em PDF**

1. Abra o pedido desejado
2. Clique em **"Exportar"** no painel de ações
3. Selecione **PDF**
4. O documento será gerado com layout profissional

📖 [Tutorial: Exportar PDF](https://zyntraerp.com.br/ajuda/artigos/tutorial-exportar-pedido-pdf.html)`
    },

    // ── COMPRAS ──
    compras: {
        keywords: /compra|pedido.*compra|comprar|fornecedor|cota[çc][aã]o|requisicao.*compra|requisi[çc][aã]o/i,
        response: `📦 **Módulo de Compras**

**Tutoriais disponíveis:**

1. **Criar pedido de compra** — Cadastre pedidos completos
2. **Cotação com fornecedores** — Compare preços e condições
3. **Entrada de nota de compra** — Registre mercadorias recebidas
4. **Cadastrar fornecedor** — Base de fornecedores organizada
5. **Requisição de compra** — Solicite compras internamente
6. **Aprovação de compras** — Fluxo de aprovação
7. **Relatórios de compras** — Análise de gastos

📖 [Tutorial: Pedido de Compra](https://zyntraerp.com.br/ajuda/artigos/tutorial-novo-pedido-compra.html)
📖 [Tutorial: Cotação](https://zyntraerp.com.br/ajuda/artigos/tutorial-cotacao-fornecedores.html)
📖 [Tutorial: Entrada de Nota](https://zyntraerp.com.br/ajuda/artigos/tutorial-entrada-nota-compra.html)
📖 [Cadastrar Fornecedor](https://zyntraerp.com.br/ajuda/artigos/tutorial-cadastrar-fornecedor.html)`
    },

    // ── FINANCEIRO ──
    financeiro: {
        keywords: /financeiro|finan[çc]a|conta.*pagar|conta.*receber|fluxo.*caixa|concilia[çc][aã]o|banc[aá]ri|dre|balan[çc]o|tesouraria/i,
        response: `💰 **Módulo Financeiro**

**Funcionalidades disponíveis:**

• **Contas a Pagar** — Gerencie todos os pagamentos
• **Contas a Receber** — Controle recebimentos
• **Fluxo de Caixa** — Projeção financeira completa
• **Conciliação Bancária** — Integre extratos bancários
• **Desconto de Duplicatas** — Antecipação de recebíveis
• **Relatórios** — DRE, balanço e análises

📖 [Contas a Pagar](https://zyntraerp.com.br/ajuda/artigos/tutorial-contas-pagar.html)
📖 [Contas a Receber](https://zyntraerp.com.br/ajuda/artigos/tutorial-contas-receber.html)
📖 [Fluxo de Caixa](https://zyntraerp.com.br/ajuda/artigos/tutorial-fluxo-caixa.html)
📖 [Conciliação Bancária](https://zyntraerp.com.br/ajuda/artigos/tutorial-conciliacao-bancaria.html)`
    },

    contasPagar: {
        keywords: /conta.*pagar|lan[çc]ar.*pagamento|pagar.*fornecedor|boleto.*pagar|vencimento/i,
        response: `💸 **Contas a Pagar**

Como lançar uma conta a pagar:
1. Acesse **Financeiro → Contas a Pagar**
2. Clique em **"Nova Conta"**
3. Informe: fornecedor, valor, vencimento, categoria
4. Defina a forma de pagamento
5. Salve e acompanhe os vencimentos

📖 [Tutorial: Contas a Pagar](https://zyntraerp.com.br/ajuda/artigos/tutorial-contas-pagar.html)`
    },

    contasReceber: {
        keywords: /conta.*receber|recebimento|receber.*cliente|cobran[çc]a|inadimpl/i,
        response: `💵 **Contas a Receber**

Como registrar um recebimento:
1. Acesse **Financeiro → Contas a Receber**
2. Localize a duplicata ou título
3. Registre o pagamento recebido
4. Confirme a baixa

📖 [Tutorial: Contas a Receber](https://zyntraerp.com.br/ajuda/artigos/tutorial-contas-receber.html)`
    },

    fluxoCaixa: {
        keywords: /fluxo.*caixa|proje[çc][aã]o.*financeira|caixa.*futuro|previs[aã]o.*financeira/i,
        response: `📊 **Fluxo de Caixa**

Consulte projeção financeira:
1. Acesse **Financeiro → Fluxo de Caixa**
2. Selecione o período desejado
3. Visualize entradas e saídas previstas
4. Analise o saldo projetado
5. Exporte relatórios

📖 [Tutorial: Fluxo de Caixa](https://zyntraerp.com.br/ajuda/artigos/tutorial-fluxo-caixa.html)`
    },

    conciliacao: {
        keywords: /concilia[çc][aã]o|extrato.*banc|importar.*extrato|conciliar/i,
        response: `🏦 **Conciliação Bancária**

Integre seus extratos bancários:
1. Acesse **Financeiro → Conciliação Bancária**
2. Importe o extrato (OFX/CSV)
3. O sistema cruza lançamentos automaticamente
4. Confirme as conciliações
5. Resolva divergências manualmente

📖 [Tutorial: Conciliação Bancária](https://zyntraerp.com.br/ajuda/artigos/tutorial-conciliacao-bancaria.html)`
    },

    descontoDuplicatas: {
        keywords: /desconto.*duplicata|antecipa[çc][aã]o|antecipa.*receb[ií]v|factoring/i,
        response: `📑 **Desconto de Duplicatas**

Antecipação de recebíveis no Aluforce:
1. Acesse **Financeiro → Desconto de Duplicatas**
2. Selecione os títulos a antecipar
3. Informe o banco e taxa de desconto
4. Confirme a operação

📖 [Desconto de Duplicatas](https://zyntraerp.com.br/ajuda/artigos/desconto-duplicatas.html)`
    },

    contasBancarias: {
        keywords: /conta.*banc[aá]ri|gerenciar.*banco|cadastrar.*banco|banco.*cadastr/i,
        response: `🏦 **Gerenciar Contas Bancárias**

1. Acesse **Financeiro → Contas Bancárias**
2. Cadastre suas contas (banco, agência, conta)
3. Defina a conta padrão
4. Integre para conciliação automática

📖 [Tutorial: Contas Bancárias](https://zyntraerp.com.br/ajuda/artigos/tutorial-gerenciar-contas-bancarias.html)`
    },

    // ── FATURAMENTO / NF-e ──
    nfe: {
        keywords: /nf-?e|nota.*fiscal|emitir.*nota|fatura.*pedido|faturar|danfe|cancelar.*nota|carta.*corre[çc][aã]o|cc-?e/i,
        response: `📄 **Notas Fiscais (NF-e)**

**Operações disponíveis:**
• **Emitir NF-e** — A partir de pedidos faturados
• **Cancelar NF-e** — Dentro do prazo de 24h
• **Carta de Correção (CC-e)** — Corrigir erros em notas emitidas
• **Entrada de NF-e** — Importar notas de fornecedores
• **Consultar NF-e** — Buscar notas emitidas
• **NFS-e Nacional** — Migração para nova plataforma

**Como faturar um pedido:**
1. Abra o pedido com status **"Aprovado"**
2. Clique em **"Faturar"**
3. Confira dados fiscais (CFOP, NCM, CST)
4. Clique em **"Emitir NF-e"**
5. Aguarde a autorização da SEFAZ

📖 [Tutorial: Faturar Pedido](https://zyntraerp.com.br/ajuda/artigos/tutorial-faturar-pedido.html)
📖 [Tutorial: Emitir NF-e](https://zyntraerp.com.br/ajuda/artigos/tutorial-emitir-nfe.html)
📖 [Tutorial: Cancelar NF-e](https://zyntraerp.com.br/ajuda/artigos/tutorial-cancelar-nfe.html)
📖 [Tutorial: Carta de Correção](https://zyntraerp.com.br/ajuda/artigos/tutorial-carta-correcao-cce.html)`
    },

    nfse: {
        keywords: /nfs-?e|nota.*servi[çc]o|nfs.*nacional|migra[çc][aã]o.*nfs/i,
        response: `📋 **NFS-e Nacional**

O Aluforce já suporta a migração para a NFS-e Nacional:
• Emissão integrada com a nova plataforma
• Consulta de notas de serviço
• Adequação automática ao novo padrão

📖 [NFS-e Nacional](https://zyntraerp.com.br/ajuda/artigos/nfs-e-nacional.html)`
    },

    pix: {
        keywords: /pix|cobran[çc]a.*pix|qr.*code|gerar.*pix|pagar.*pix/i,
        response: `💳 **Cobrança PIX**

Gere cobranças PIX pelo Aluforce:
1. Acesse **Faturamento → Cobrança PIX**
2. Selecione o título ou valor
3. Gere o QR Code
4. Envie ao cliente por e-mail ou WhatsApp

📖 [Tutorial: Cobrança PIX](https://zyntraerp.com.br/ajuda/artigos/tutorial-pix-cobranca.html)`
    },

    reguaCobranca: {
        keywords: /r[eé]gua.*cobran[çc]a|cobran[çc]a.*autom[aá]tica|lembrete.*pagamento|notifica[çc][aã]o.*vencimento/i,
        response: `🔔 **Régua de Cobrança**

Configure cobranças automáticas:
1. Acesse **Faturamento → Régua de Cobrança**
2. Defina os gatilhos (X dias antes, no dia, X dias depois)
3. Personalize as mensagens
4. Ative a régua para clientes

📖 [Tutorial: Régua de Cobrança](https://zyntraerp.com.br/ajuda/artigos/tutorial-regua-cobranca.html)`
    },

    // ── ESTOQUE ──
    estoque: {
        keywords: /estoque|invent[aá]rio|saldo.*estoque|entrada.*mercadoria|sa[ií]da.*mercadoria|consultar.*estoque|movimenta[çc][aã]o|armazem|almoxarifado/i,
        response: `📦 **Módulo de Estoque**

Controle completo de inventário:
• Consultar saldo de produtos
• Movimentações de entrada e saída
• Inventário e contagem
• Rastreabilidade de lotes

📖 [Tutorial: Consultar Estoque](https://zyntraerp.com.br/ajuda/artigos/tutorial-consultar-estoque.html)
📖 [Módulo Estoque](https://zyntraerp.com.br/ajuda/colecoes/estoque.html)`
    },

    // ── PCP / PRODUÇÃO ──
    pcp: {
        keywords: /pcp|produ[çc][aã]o|ordem.*produ[çc][aã]o|op\b|kanban|apontar.*produ[çc][aã]o|bom\b|estrutura.*material|apontamento/i,
        response: `🏭 **PCP — Produção**

**Funcionalidades:**
• **Ordem de Produção (OP)** — Criar e gerenciar OPs
• **Kanban** — Apontar produção visual
• **Estoque de Materiais** — Consultar disponibilidade
• **Relatórios de Produção** — Análise de performance
• **Estrutura de Materiais (BOM)** — Composição dos produtos

**Como criar uma Ordem de Produção:**
1. Acesse **PCP → Ordens de Produção**
2. Clique em **"Nova OP"**
3. Selecione o produto e quantidade
4. O sistema verifica materiais disponíveis
5. Inicie a produção

📖 [Tutorial: Criar OP](https://zyntraerp.com.br/ajuda/artigos/tutorial-criar-ordem-producao.html)
📖 [Tutorial: Apontar Produção](https://zyntraerp.com.br/ajuda/artigos/tutorial-apontar-producao.html)
📖 [Tutorial: Estrutura BOM](https://zyntraerp.com.br/ajuda/artigos/tutorial-estrutura-bom.html)`
    },

    // ── RH ──
    rh: {
        keywords: /rh|recursos.*humanos|holerite|f[eé]rias|ponto.*eletron|funcionario|funcion[aá]rio|folha.*pagamento|treinamento|admiss[aã]o|demiss[aã]o|contracheque/i,
        response: `👥 **Recursos Humanos**

**Funcionalidades disponíveis:**
• **Holerite** — Consultar contracheque online
• **Férias** — Solicitar e acompanhar férias
• **Ponto Eletrônico** — Registrar entrada/saída
• **Cadastro de Funcionários** — Dados completos
• **Treinamentos** — Gerenciar capacitações

📖 [Tutorial: Consultar Holerite](https://zyntraerp.com.br/ajuda/artigos/tutorial-consultar-holerite.html)
📖 [Tutorial: Solicitar Férias](https://zyntraerp.com.br/ajuda/artigos/tutorial-solicitar-ferias.html)
📖 [Tutorial: Registrar Ponto](https://zyntraerp.com.br/ajuda/artigos/tutorial-registrar-ponto.html)
📖 [Tutorial: Cadastrar Funcionário](https://zyntraerp.com.br/ajuda/artigos/tutorial-cadastrar-funcionario.html)`
    },

    holerite: {
        keywords: /holerite|contracheque|sal[aá]rio|demonstrativo.*pagamento|quanto.*ganho/i,
        response: `💰 **Consultar Holerite**

1. Acesse **RH → Meu Holerite**
2. Selecione o mês/ano desejado
3. Visualize proventos e descontos
4. Baixe em PDF se necessário

📖 [Tutorial: Consultar Holerite](https://zyntraerp.com.br/ajuda/artigos/tutorial-consultar-holerite.html)`
    },

    ferias: {
        keywords: /f[eé]rias|solicitar.*f[eé]rias|minhas.*f[eé]rias|agendar.*f[eé]rias/i,
        response: `🏖️ **Solicitar Férias**

1. Acesse **RH → Minhas Férias**
2. Clique em **"Solicitar Férias"**
3. Selecione o período desejado
4. Envie para aprovação do gestor

📖 [Tutorial: Solicitar Férias](https://zyntraerp.com.br/ajuda/artigos/tutorial-solicitar-ferias.html)`
    },

    ponto: {
        keywords: /ponto|registrar.*ponto|bater.*ponto|entrada.*sa[ií]da|jornada|hor[aá]rio/i,
        response: `⏰ **Ponto Eletrônico**

1. Acesse **RH → Ponto Eletrônico**
2. Clique em **"Registrar Ponto"**
3. Confirme sua entrada ou saída
4. Consulte seu espelho de ponto

📖 [Tutorial: Registrar Ponto](https://zyntraerp.com.br/ajuda/artigos/tutorial-registrar-ponto.html)`
    },

    // ── CADASTROS ──
    cadastros: {
        keywords: /cadastr.*cliente|cadastr.*produto|cadastr.*servi[çc]o|base.*cliente|cliente.*novo|produto.*novo/i,
        response: `📝 **Cadastros**

Gerencie sua base de dados:
• **Clientes** — Razão social, CNPJ/CPF, contatos
• **Fornecedores** — Base completa de fornecedores
• **Produtos** — Catálogo com preços e estoque
• **Serviços** — Serviços prestados pela empresa

📖 [Cadastros](https://zyntraerp.com.br/ajuda/colecoes/cadastros.html)
📖 [Cadastrar Fornecedor](https://zyntraerp.com.br/ajuda/artigos/tutorial-cadastrar-fornecedor.html)`
    },

    // ── RELATÓRIOS ──
    relatorios: {
        keywords: /relat[oó]rio|report|dashboard|indicador|an[aá]lise|exportar.*dados|performance|desempenho.*venda/i,
        response: `📊 **Relatórios**

O Aluforce possui relatórios em todos os módulos:
• **Vendas** — Performance, comissões, faturamento
• **Compras** — Gastos, fornecedores, comparativos
• **Financeiro** — DRE, balanço, fluxo de caixa
• **Estoque** — Saldos, movimentações, giro
• **PCP** — Produção, eficiência, apontamentos
• **RH** — Folha, ponto, treinamentos

📖 [Relatórios de Vendas](https://zyntraerp.com.br/ajuda/artigos/relatorios-vendas.html)
📖 [Relatórios Financeiros](https://zyntraerp.com.br/ajuda/artigos/relatorios-financeiros.html)`
    },

    // ── SEGURANÇA / PERMISSÕES ──
    seguranca: {
        keywords: /seguran[çc]a|permiss[aãõ]|usu[aá]rio.*permiss|quem.*acessa|nivel.*acesso|restringir|bloquear.*usu/i,
        response: `🔒 **Segurança e Permissões**

Gerencie acesso ao sistema:
1. Acesse **Admin → Usuários e Permissões**
2. Defina níveis de acesso por módulo
3. Restrinja ações (visualizar, criar, editar, excluir)
4. Configure perfis de acesso por departamento

📖 [Usuários e Permissões](https://zyntraerp.com.br/ajuda/artigos/usuarios-permissoes.html)
📖 [Segurança](https://zyntraerp.com.br/ajuda/colecoes/seguranca.html)`
    },

    // ── WHATSAPP ──
    whatsapp: {
        keywords: /whatsapp|wpp|whats|zap|gerenciar.*whatsapp|erp.*whatsapp/i,
        response: `📱 **Aluforce no WhatsApp**

Gerencie seu negócio pelo WhatsApp:
• Consulte pedidos e status
• Receba notificações de vencimentos
• Acompanhe vendas em tempo real
• Interaja com o sistema pelo celular

📖 [Aluforce no WhatsApp](https://zyntraerp.com.br/ajuda/colecoes/whatsapp.html)`
    },

    // ── CENÁRIOS DE NEGÓCIO ──
    cenarios: {
        keywords: /cen[aá]rio.*neg[oó]cio|exemplo.*pr[aá]tico|caso.*uso|dia.*dia|como.*uso.*sistema/i,
        response: `💼 **Cenários de Negócio na Prática**

Exemplos práticos para seu dia a dia:
• Como processar uma venda do início ao fim
• Fluxo completo de compra e recebimento
• Ciclo financeiro: faturamento → cobrança → recebimento
• Produção: pedido → OP → apontamento → entrega

📖 [Cenários de Negócio](https://zyntraerp.com.br/ajuda/colecoes/cenarios.html)`
    },

    // ── NOVIDADES ──
    novidades: {
        keywords: /novidade|atualiza[çc][aã]o|novo.*recurso|lan[çc]amento|changelog|o que.*novo|release/i,
        response: `🆕 **Novidades do Aluforce**

Fique por dentro das últimas atualizações:
• Novos módulos e funcionalidades
• Melhorias de interface
• Correções e otimizações
• Integrações novas

📖 [Novidades](https://zyntraerp.com.br/ajuda/colecoes/novidades.html)`
    },

    // ── PORTAL ──
    portal: {
        keywords: /portal|plataforma.*comunica|portal.*aluforce|comunica[çc][aã]o.*interna/i,
        response: `🌐 **Portal Aluforce**

Plataforma que simplifica comunicação e gestão:
• Dashboard centralizado
• Comunicação interna entre departamentos
• Acesso rápido a todos os módulos
• Indicadores em tempo real

📖 [Portal Aluforce](https://zyntraerp.com.br/ajuda/colecoes/portal.html)`
    },

    // ── TI / SUPORTE TÉCNICO (mantém os originais) ──
    senha: {
        keywords: /senha|password|esqueci.*senha|redefinir|resetar|trocar.*senha|n[aã]o.*consigo.*entrar|bloqueado/i,
        response: null // handled dynamically with tiIsOnline
    },

    internet: {
        keywords: /internet|rede|wifi|wi-fi|conex[aã]o|conectar|desconect|sem.*rede|caiu.*net/i,
        response: null
    },

    impressora: {
        keywords: /impress|printer|impressora|imprimir|papel|toner|scanner|scan|digitaliz/i,
        response: null
    },

    email: {
        keywords: /email|e-mail|outlook|correio|spam|anexo/i,
        response: null
    },

    pcLento: {
        keywords: /computador.*lento|pc.*lento|travando|trava|congelou|mem[oó]ria|ram\b|performance/i,
        response: null
    },

    softwareInstalar: {
        keywords: /instalar.*programa|software|aplicativo|atualizar.*windows|update.*sistema|licen[çc]a/i,
        response: null
    },

    virusSeg: {
        keywords: /v[ií]rus|malware|hack|invas[aã]o|phishing|suspeito|antiv[ií]rus/i,
        response: null
    }
};

function handleBotMessage(socket, chatNs, pool, fromId, userMessage) {
    const botUser = {
        id: -1,
        displayName: 'BOB I.A.',
        avatarColor: '#A855F7',
        isBot: true
    };

    // Simular digitação
    setTimeout(() => {
        socket.emit('chat:typing:start', { toId: fromId, user: 'BOB I.A.', isBot: true });
    }, 300);

    // Gerar resposta (async due to OpenAI fallback)
    const delay = 800 + Math.random() * 700;
    setTimeout(async () => {
        const tiOnline = Array.from(onlineUsers.values()).some(ou =>
            ou.user.department === 'TI' && ou.user.id !== -1
        );

        const response = await generateBotResponse(userMessage, tiOnline, pool, fromId);

        socket.emit('chat:typing:stop', { toId: fromId, user: 'BOB I.A.' });

        // Persistir resposta do bot no MySQL
        let insertId = Date.now();
        try {
            const [result] = await pool.query(
                'INSERT INTO chat_mensagens_diretas (de_usuario_id, para_usuario_id, conteudo) VALUES (?, ?, ?)',
                [-1, fromId, response]
            );
            insertId = result.insertId;
        } catch(e) { /* bot user -1 may not have FK, use timestamp as id */ }

        const botMsg = {
            id: insertId,
            fromId: -1,
            toId: fromId,
            content: response,
            createdAt: new Date().toISOString(),
            displayName: 'BOB I.A.',
            avatarColor: '#A855F7',
            isBot: true
        };

        socket.emit('chat:dm:message', botMsg);
    }, delay);
}

// ═══════════════════════════════════════════════════════════
// OpenAI Integration for BOB I.A.
// ═══════════════════════════════════════════════════════════
let _openai = null;
function getOpenAI() {
    if (_openai) return _openai;
    try {
        const OpenAI = require('openai');
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return _openai;
    } catch(e) {
        console.error('[BOB] Erro ao inicializar OpenAI:', e.message);
        return null;
    }
}

const BOB_SYSTEM_PROMPT = `Você é o BOB I.A., assistente virtual do sistema Aluforce ERP.
Você ajuda colaboradores com dúvidas sobre os módulos do sistema: Vendas, Compras, Financeiro, NF-e/NFS-e, PCP, RH, Estoque, Relatórios, Logística e WhatsApp Business.
Responda sempre em português brasileiro, de forma profissional mas amigável.
Use emojis moderadamente para tornar a conversa mais agradável.
Quando não souber a resposta exata, oriente o usuário a acessar a Central de Ajuda em https://zyntraerp.com.br/ajuda.
Seja conciso — respostas curtas e diretas são preferidas. Máximo 300 palavras.
Nunca invente funcionalidades que o sistema não tem.
Módulos disponíveis: Vendas (pedidos, orçamentos, comissões, prospecção), Compras (pedidos, cotações, fornecedores, recebimento), Financeiro (contas a pagar/receber, fluxo de caixa, conciliação, PIX, boletos), NF-e/NFS-e (emissão, cancelamento, carta de correção, DANFE), PCP (ordens de produção, kanban, BOM), RH (holerite, férias, ponto, treinamentos), Estoque (saldos, movimentações, inventário), Relatórios, Logística (entregas, rastreamento), WhatsApp Business.`;

async function askOpenAI(userMessage, pool, userId) {
    const openai = getOpenAI();
    if (!openai) return null;

    try {
        // Load recent conversation history for context
        const messages = [{ role: 'system', content: BOB_SYSTEM_PROMPT }];

        try {
            const [history] = await pool.query(
                `SELECT de_usuario_id, conteudo FROM chat_mensagens_diretas
                 WHERE (de_usuario_id = ? AND para_usuario_id = -1) OR (de_usuario_id = -1 AND para_usuario_id = ?)
                 ORDER BY criado_em DESC LIMIT 10`,
                [userId, userId]
            );
            // Reverse to chronological order (oldest first)
            history.reverse().forEach(row => {
                messages.push({
                    role: row.de_usuario_id === -1 ? 'assistant' : 'user',
                    content: row.conteudo
                });
            });
        } catch(e) { /* ignore history load errors */ }

        // Add current message
        messages.push({ role: 'user', content: userMessage });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            max_tokens: 500,
            temperature: 0.7
        });

        return completion.choices[0]?.message?.content || null;
    } catch(e) {
        console.error('[BOB] Erro OpenAI:', e.message);
        return null;
    }
}

async function generateBotResponse(userMessage, tiIsOnline, pool, userId) {
    const msg = userMessage.toLowerCase().trim();

    // ── Saudações ──
    if (/^(oi|olá|ola|hey|hello|bom dia|boa tarde|boa noite|e a[ií]|eae|fala|opa)\b/i.test(msg)) {
        const greetings = [
            `Olá! 👋 Sou o **BOB I.A.**, assistente virtual do Aluforce ERP!\n\nPosso te ajudar com qualquer módulo do sistema:\n🛒 Vendas • 📦 Compras • 💰 Financeiro\n📄 NF-e • 🏭 PCP • 👥 RH • 📦 Estoque\n\nDigite sua dúvida ou **"ajuda"** para ver tudo que sei! 💡`,
            `Oi! 🤖 Sou o **BOB**, seu assistente virtual!\n\nPosso orientar sobre todos os módulos do Aluforce:\nVendas, Compras, Financeiro, NF-e, PCP, RH e muito mais!\n\nMe conte: **o que você precisa fazer?**`,
            `Olá! Bem-vindo ao suporte do Aluforce! 💡\n\nSou o **BOB I.A.** e conheço todos os módulos do sistema.\nDescreva sua dúvida que vou te orientar com tutoriais e dicas!`
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    }

    // ── Agradecimentos ──
    if (/^(obrigad|valeu|thanks|brigad|show|perfeito|resolveu|funcionou|consegui|massa|top|legal|maravilha)/i.test(msg)) {
        const thanks = [
            'De nada! 😊 Se precisar de mais alguma ajuda com o sistema, é só perguntar!',
            'Disponha! 🤖 Estou aqui 24/7 para ajudar com o Aluforce!',
            'Que bom que ajudou! ✅ Lembre-se: a Central de Ajuda tem tutoriais detalhados em https://zyntraerp.com.br/ajuda'
        ];
        return thanks[Math.floor(Math.random() * thanks.length)];
    }

    // ── Menu de ajuda completo ──
    if (/^(ajuda|help|menu|op[çc][oõ]es|o que voc[eê] faz|comandos|tudo|todos.*modulo)/i.test(msg)) {
        return `🤖 **BOB I.A. — Assistente Aluforce ERP**\n\nPosso ajudar com **todos os módulos**:\n\n📋 **Guia Inicial** — Primeiro acesso, configurações\n🛒 **Vendas** — Pedidos, orçamentos, comissões, prospecção\n📦 **Compras** — Pedidos, cotações, fornecedores\n💰 **Financeiro** — Contas, fluxo de caixa, conciliação, PIX\n📄 **NF-e / NFS-e** — Emissão, cancelamento, carta de correção\n🏭 **PCP** — Ordens de produção, kanban, BOM\n👥 **RH** — Holerite, férias, ponto, treinamentos\n📦 **Estoque** — Saldos, movimentações, inventário\n📊 **Relatórios** — Todos os módulos\n🔒 **Segurança** — Permissões e acessos\n📱 **WhatsApp** — ERP pelo celular\n🔐 **TI** — Senha, rede, impressora, e-mail\n\n💡 Digite o assunto! Ex: *\"como criar pedido de venda\"*\n📖 Central de Ajuda: https://zyntraerp.com.br/ajuda`;
    }

    // ── Buscar na base de conhecimento ──
    for (const [key, topic] of Object.entries(BOB_KNOWLEDGE_BASE)) {
        if (topic.keywords.test(msg)) {
            // Tópicos com resposta estática (ERP)
            if (topic.response) {
                return topic.response;
            }

            // Tópicos de TI (resposta dinâmica baseada em tiOnline)
            switch (key) {
                case 'senha':
                    return tiIsOnline
                        ? `🔐 **Problemas com senha/acesso?**\n\nUm técnico do TI está **online agora**! Envie uma mensagem direta para ele.\n\n**Enquanto isso, tente:**\n• Verifique se o Caps Lock está desativado\n• Limpe o cache do navegador (Ctrl+Shift+Del)\n• Tente a opção "Esqueci minha senha"\n\n📖 [Primeiro Acesso](https://zyntraerp.com.br/ajuda/artigos/primeiro-acesso.html)`
                        : `🔐 **Problemas com senha/acesso?**\n\n1. Verifique se o **Caps Lock** está desativado\n2. Tente **"Esqueci minha senha"** na tela de login\n3. Limpe o cache: **Ctrl+Shift+Del**\n4. Tente outro navegador (Chrome, Firefox, Edge)\n\n📖 [Primeiro Acesso](https://zyntraerp.com.br/ajuda/artigos/primeiro-acesso.html)\n\n⏰ TI disponível: Seg-Sex, 8h às 18h`;
                case 'internet':
                    return `🌐 **Problemas de conectividade?**\n\n1. **Reinicie** roteador/modem (desligue 30s)\n2. Reconecte o Wi-Fi\n3. CMD: \`ipconfig /release\` → \`ipconfig /renew\`\n4. Teste em outro dispositivo\n5. Tente cabo de rede\n\n${tiIsOnline ? '✅ TI online para ajudar!' : '⏰ TI offline — registre o problema.'}`;
                case 'impressora':
                    return `🖨️ **Problemas com impressora?**\n\n1. Verifique se está **ligada e conectada**\n2. Veja se há **papel preso**\n3. Reinicie a impressora\n4. **Painel de Controle → Dispositivos e Impressoras**\n5. Limpe a fila de impressão\n\n${tiIsOnline ? '✅ TI online!' : '⏰ Solicite ao TI quando retornar.'}`;
                case 'email':
                    return `📧 **Problemas com e-mail?**\n\n1. Verifique **conexão com internet**\n2. Tente acessar pelo **webmail**\n3. Outlook: **Arquivo → Configurações de Conta**\n4. Verifique pasta de **Spam/Lixo**\n5. Limite de anexo: 25MB\n\n${tiIsOnline ? '✅ TI online para verificar!' : '📝 Anote o erro e reporte ao TI.'}`;
                case 'pcLento':
                    return `🖥️ **Computador lento?**\n\n1. **Reinicie** (resolve 80% dos casos!)\n2. Feche programas: **Ctrl+Alt+Del → Gerenciador**\n3. Verifique espaço em disco (>10% livre)\n4. Desative programas na **Inicialização**\n5. **Limpeza de Disco** no menu Iniciar\n\n${tiIsOnline ? '✅ TI pode verificar remotamente!' : '⏰ Agende com TI.'}`;
                case 'softwareInstalar':
                    return `💿 **Instalação/Software?**\n\nPor segurança:\n• Instalações devem ser solicitadas ao **TI**\n• Não instale programas desconhecidos\n• Atualizações do Windows são automáticas\n\n${tiIsOnline ? '✅ Solicite ao TI online!' : '📝 Anote e solicite ao TI.\n⏰ Seg-Sex, 8h às 18h'}`;
                case 'virusSeg':
                    return `🛡️ **Alerta de Segurança!**\n\n⚠️ Se suspeita de vírus:\n1. **NÃO clique** em links suspeitos\n2. **Desconecte** da rede\n3. **NÃO desligue** o PC\n4. Execute verificação do **antivírus**\n5. Mude senhas de outro dispositivo\n\n${tiIsOnline ? '🚨 Contate o TI IMEDIATAMENTE!' : '🚨 Mantenha PC desconectado até o TI verificar!'}`;
            }
        }
    }

    // ── Fallback: usar OpenAI para respostas inteligentes ──
    if (pool && userId) {
        const aiResponse = await askOpenAI(userMessage, pool, userId);
        if (aiResponse) return aiResponse;
    }

    // ── Fallback geral (sem OpenAI disponível) ──
    return `🤖 Não encontrei uma resposta exata para isso, mas posso te orientar!\n\n**Opções:**\n• Digite **"ajuda"** para ver todos os tópicos\n• Acesse a Central de Ajuda: https://zyntraerp.com.br/ajuda\n• Acesse os Tutoriais: https://zyntraerp.com.br/ajuda/colecoes/tutoriais.html\n${tiIsOnline ? '\n✅ Ou fale com o **TI online** para questões técnicas!' : '\n⏰ TI disponível: Seg-Sex, 8h às 18h'}`;
}
