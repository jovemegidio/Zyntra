/**
 * MIGRAÇÃO — Tabelas do Chat Corporativo (Teams)
 * 
 * Cria as tabelas necessárias para o sistema de chat integrado:
 * - chat_canais: Canais de grupo (ex: #geral, #ti, #rh)
 * - chat_mensagens_canal: Mensagens enviadas em canais
 * - chat_mensagens_diretas: Mensagens diretas entre usuários
 * 
 * Usuários vêm da tabela `usuarios` existente — sem duplicação.
 */

async function createChatTables(pool) {
    console.log('[CHAT-MIGRATION] Iniciando criação das tabelas do chat...');

    // 1. Tabela de canais
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_canais (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(100) NOT NULL UNIQUE,
            descricao VARCHAR(500) DEFAULT '',
            criado_por INT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            ativo TINYINT(1) DEFAULT 1,
            INDEX idx_nome (nome),
            CONSTRAINT fk_chat_canal_criador FOREIGN KEY (criado_por)
                REFERENCES usuarios(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[CHAT-MIGRATION] ✅ chat_canais criada');

    // 2. Tabela de mensagens de canal
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_mensagens_canal (
            id INT AUTO_INCREMENT PRIMARY KEY,
            canal_id INT NOT NULL,
            usuario_id INT NOT NULL,
            conteudo TEXT NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_canal_data (canal_id, criado_em),
            INDEX idx_usuario (usuario_id),
            CONSTRAINT fk_chat_msg_canal FOREIGN KEY (canal_id)
                REFERENCES chat_canais(id) ON DELETE CASCADE,
            CONSTRAINT fk_chat_msg_usuario FOREIGN KEY (usuario_id)
                REFERENCES usuarios(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[CHAT-MIGRATION] ✅ chat_mensagens_canal criada');

    // 3. Tabela de mensagens diretas
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_mensagens_diretas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            de_usuario_id INT NOT NULL,
            para_usuario_id INT NOT NULL,
            conteudo TEXT NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            lida TINYINT(1) DEFAULT 0,
            INDEX idx_conversa (de_usuario_id, para_usuario_id, criado_em),
            INDEX idx_destinatario (para_usuario_id, lida),
            CONSTRAINT fk_chat_dm_de FOREIGN KEY (de_usuario_id)
                REFERENCES usuarios(id) ON DELETE CASCADE,
            CONSTRAINT fk_chat_dm_para FOREIGN KEY (para_usuario_id)
                REFERENCES usuarios(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[CHAT-MIGRATION] ✅ chat_mensagens_diretas criada');

    // 4. Inserir canais padrão se não existirem
    const [existingChannels] = await pool.query('SELECT COUNT(*) as total FROM chat_canais');
    if (existingChannels[0].total === 0) {
        await pool.query(`
            INSERT INTO chat_canais (nome, descricao, departamento, somente_admin) VALUES
            ('geral', 'Canal geral da empresa — todos os colaboradores', 'todos', 0),
            ('avisos', 'Comunicados oficiais da empresa', 'todos', 1),
            ('ti', 'Canal do departamento de TI', 'ti', 0),
            ('rh', 'Canal de Recursos Humanos', 'rh', 0),
            ('comercial', 'Canal do time Comercial', 'comercial', 0),
            ('financeiro', 'Canal do Financeiro', 'financeiro', 0),
            ('pcp', 'Canal de PCP / Produção', 'pcp', 0)
        `);
        console.log('[CHAT-MIGRATION] ✅ Canais padrão criados (geral, avisos, ti, rh, comercial, financeiro, pcp)');
    }

    // 5. Adicionar colunas novas nas tabelas existentes (idempotente com ALTER IGNORE)
    const alterQueries = [
        // chat_canais — departamento e somente_admin
        "ALTER TABLE chat_canais ADD COLUMN IF NOT EXISTS departamento VARCHAR(100) DEFAULT 'todos'",
        "ALTER TABLE chat_canais ADD COLUMN IF NOT EXISTS somente_admin TINYINT(1) DEFAULT 0",
        // chat_mensagens_canal — editado, editado_em, excluida
        "ALTER TABLE chat_mensagens_canal ADD COLUMN IF NOT EXISTS editado TINYINT(1) DEFAULT 0",
        "ALTER TABLE chat_mensagens_canal ADD COLUMN IF NOT EXISTS editado_em DATETIME DEFAULT NULL",
        "ALTER TABLE chat_mensagens_canal ADD COLUMN IF NOT EXISTS excluida TINYINT(1) DEFAULT 0",
        // chat_mensagens_diretas — editado, editado_em, excluida, excluida_para
        "ALTER TABLE chat_mensagens_diretas ADD COLUMN IF NOT EXISTS editado TINYINT(1) DEFAULT 0",
        "ALTER TABLE chat_mensagens_diretas ADD COLUMN IF NOT EXISTS editado_em DATETIME DEFAULT NULL",
        "ALTER TABLE chat_mensagens_diretas ADD COLUMN IF NOT EXISTS excluida TINYINT(1) DEFAULT 0",
        "ALTER TABLE chat_mensagens_diretas ADD COLUMN IF NOT EXISTS excluida_para JSON DEFAULT NULL",
    ];

    for (const q of alterQueries) {
        try { await pool.query(q); } catch(e) {
            // MySQL < 8.0.1 doesn't support IF NOT EXISTS on ALTER, try without
            try {
                const col = q.match(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/)?.[1];
                if (col) {
                    const tbl = q.match(/ALTER TABLE (\w+)/)?.[1];
                    const [cols] = await pool.query(`SHOW COLUMNS FROM ${tbl} LIKE '${col}'`);
                    if (cols.length === 0) {
                        await pool.query(q.replace('IF NOT EXISTS ', ''));
                    }
                }
            } catch(e2) { console.log(`[CHAT-MIGRATION] ⚠️ Coluna já existe ou erro: ${e2.message}`); }
        }
    }
    console.log('[CHAT-MIGRATION] ✅ Colunas novas adicionadas (departamento, somente_admin, editado, excluida)');

    // 6. Atualizar canais padrão existentes com departamentos
    const deptDefaults = [
        ['geral', 'todos', 0],
        ['avisos', 'todos', 1],
        ['ti', 'ti', 0],
        ['rh', 'rh', 0],
        ['comercial', 'comercial', 0],
        ['financeiro', 'financeiro', 0],
        ['pcp', 'pcp', 0]
    ];
    for (const [nome, dept, adminOnly] of deptDefaults) {
        try {
            await pool.query(
                'UPDATE chat_canais SET departamento = ?, somente_admin = ? WHERE nome = ? AND (departamento IS NULL OR departamento = \'todos\')',
                [dept, adminOnly, nome]
            );
        } catch(e) {}
    }

    console.log('[CHAT-MIGRATION] ✅ Migração do chat concluída com sucesso!');
}

module.exports = { createChatTables };
