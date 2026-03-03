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
                displayName: u.apelido || u.nome || u.email.split('@')[0],
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
                displayName: r.apelido || r.nome || 'Desconhecido',
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

            // Se for DM com o bot (id=-1), retornar vazio (bot responde em tempo real via socket)
            if (otherId === -1) {
                return res.json([]);
            }

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
                displayName: r.apelido || r.nome || 'Desconhecido',
                avatarColor: AVATAR_COLORS[r.de_usuario_id % AVATAR_COLORS.length],
                foto: r.foto || r.avatar || null,
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
                    displayName: user.apelido || user.nome || 'Desconhecido',
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

                // Se for mensagem para o bot (-1), responder com I.A.
                if (toId === -1) {
                    handleBotMessage(socket, chatNs, fromId, content || '');
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
                    displayName: user.apelido || user.nome || 'Desconhecido',
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
// BOT I.A. DE SUPORTE
// ═══════════════════════════════════════════════════════════

function handleBotMessage(socket, chatNs, fromId, userMessage) {
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

    // Gerar resposta com delay natural
    const delay = 1000 + Math.random() * 1500;
    setTimeout(() => {
        socket.emit('chat:typing:stop', { toId: fromId, user: 'BOB I.A.' });

        const tiOnline = Array.from(onlineUsers.values()).some(ou =>
            ou.user.department === 'TI' && ou.user.id !== -1
        );

        const response = generateBotResponse(userMessage, tiOnline);
        const botMsg = {
            id: Date.now(),
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

function generateBotResponse(userMessage, tiIsOnline) {
    const msg = userMessage.toLowerCase().trim();

    if (/^(oi|olá|ola|hey|hello|bom dia|boa tarde|boa noite|e aí|eae|fala)/i.test(msg)) {
        const greetings = [
            `Olá! 👋 Sou o BOB I.A., assistente virtual do departamento de TI.\n\nComo posso ajudar você hoje?`,
            `Oi! 🤖 Sou o BOB! Estou aqui para ajudar com questões de TI.\n\nMe conte o que está acontecendo!`,
            `Olá! Bem-vindo! Eu sou o BOB, suporte técnico virtual! 💡\n\nDescreva seu problema que vou tentar ajudar.`
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    }

    if (/senha|password|login|acesso|acessar|entrar|esqueci|redefinir|resetar|trocar senha/i.test(msg)) {
        return tiIsOnline
            ? `🔐 **Problemas com senha/acesso?**\n\nUm técnico do TI está online agora! Envie uma mensagem direta para ele.\n\n• Verifique se o Caps Lock está desativado\n• Tente o último password que lembra\n• Limpe o cache do navegador (Ctrl+Shift+Del)`
            : `🔐 **Problemas com senha/acesso?**\n\nO TI não está online no momento.\n\n1. Verifique se o **Caps Lock** está desativado\n2. Tente "Esqueci minha senha" na tela de login\n3. Limpe o cache: **Ctrl+Shift+Del**\n4. Anote os detalhes para o TI resolver depois\n\n⏰ Horário TI: Seg-Sex, 8h às 18h`;
    }

    if (/internet|rede|wifi|wi-fi|conexão|conectar|desconect|lento|lenta|velocidade|ping|caiu|sem rede/i.test(msg)) {
        return `🌐 **Problemas de conectividade?**\n\n1. **Reinicie** roteador/modem (desligue 30s)\n2. Reconecte o Wi-Fi\n3. CMD: \`ipconfig /release\` → \`ipconfig /renew\`\n4. Teste em outro dispositivo\n5. Tente cabo de rede\n\n${tiIsOnline ? '✅ TI online para ajudar!' : '⏰ TI offline — registre o problema.'}`;
    }

    if (/impress|printer|impressora|imprimir|papel|toner|scanner|scan|digitaliz/i.test(msg)) {
        return `🖨️ **Problemas com impressora?**\n\n1. Verifique se está **ligada e conectada**\n2. Veja se há **papel preso**\n3. Reinicie a impressora\n4. **Painel de Controle → Dispositivos e Impressoras**\n5. Limpe a fila de impressão\n\n${tiIsOnline ? '✅ TI online!' : '⏰ TI resolverá quando retornar.'}`;
    }

    if (/email|e-mail|outlook|correio|spam|anexo/i.test(msg)) {
        return `📧 **Problemas com e-mail?**\n\n1. Verifique **conexão com internet**\n2. Tente acessar pelo **webmail**\n3. Outlook: **Arquivo → Configurações de Conta**\n4. Verifique pasta de **Spam/Lixo**\n5. Limite de anexo: 25MB\n\n${tiIsOnline ? '✅ TI online para verificar conta!' : '📝 Anote o erro e reporte ao TI.'}`;
    }

    if (/lento|lenta|travando|trava|demora|congelou|memória|ram|performance|desempenho/i.test(msg)) {
        return `🖥️ **Computador lento?**\n\n1. **Reinicie** (resolve 80% dos casos!)\n2. Feche programas: **Ctrl+Alt+Del → Gerenciador**\n3. Verifique espaço em disco (>10% livre)\n4. Desative programas na **Inicialização**\n5. **Limpeza de Disco** no menu Iniciar\n\n${tiIsOnline ? '✅ TI pode verificar remotamente!' : '⏰ Agende verificação com TI.'}`;
    }

    if (/instalar|programa|software|aplicativo|atualizar|update|licença|ativar/i.test(msg)) {
        return `💿 **Instalação/Software?**\n\nPor segurança:\n• Instalações devem ser solicitadas ao **TI**\n• Não instale programas desconhecidos\n• Atualizações Windows: automáticas\n\n${tiIsOnline ? '✅ Solicite ao TI online!' : '📝 Anote e solicite ao TI.\n⏰ Seg-Sex, 8h às 18h'}`;
    }

    if (/vírus|virus|malware|segurança|hack|invasão|phishing|suspeito|antivírus/i.test(msg)) {
        return `🛡️ **Alerta de Segurança!**\n\n⚠️ Se suspeita de vírus:\n1. **NÃO clique** em links suspeitos\n2. **Desconecte** da rede\n3. **NÃO desligue** o PC\n4. Execute verificação do **antivírus**\n5. Mude senhas de outro dispositivo\n\n${tiIsOnline ? '🚨 Contate o TI IMEDIATAMENTE!' : '🚨 Mantenha PC desconectado!'}`;
    }

    if (/obrigad|valeu|thanks|brigad|show|perfeito|resolveu|funcionou|consegui/i.test(msg)) {
        const thanks = [
            'De nada! 😊 Se precisar, é só chamar.',
            'Disponha! 🤖 Estou aqui 24/7!',
            'Que bom que ajudou! ✅ Qualquer dúvida, estou por aqui!'
        ];
        return thanks[Math.floor(Math.random() * thanks.length)];
    }

    if (/ajuda|help|menu|opções|o que você faz|comandos/i.test(msg)) {
        return `🤖 **Sou o BOB I.A.!** Posso ajudar com:\n\n🔐 Senha e Acesso\n🌐 Internet/Rede\n🖨️ Impressora\n📧 E-mail\n🖥️ PC Lento\n💿 Software\n🛡️ Segurança\n\nDigite sobre seu problema! 💡\n\n${tiIsOnline ? '✅ TI online para casos complexos.' : '⏰ TI offline — estou cobrindo!'}`;
    }

    return tiIsOnline
        ? `🤖 Para essa questão, recomendo o **técnico do TI** que está online agora!\n\nDigite **"ajuda"** para ver tudo que posso fazer.`
        : `🤖 O **TI está offline**.\n\n1. **Reinicie** o equipamento\n2. Verifique se outros colegas têm o mesmo problema\n3. Anote a **mensagem de erro**\n4. Anote **horário e frequência**\n\n💡 Digite **"ajuda"** para ver os temas que posso orientar.`;
}
