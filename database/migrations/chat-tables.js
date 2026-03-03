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
            INSERT INTO chat_canais (nome, descricao) VALUES
            ('geral', 'Canal geral da empresa — todos os colaboradores'),
            ('ti', 'Canal do departamento de TI'),
            ('rh', 'Canal de Recursos Humanos'),
            ('comercial', 'Canal do time Comercial'),
            ('financeiro', 'Canal do Financeiro'),
            ('pcp', 'Canal de PCP / Produção')
        `);
        console.log('[CHAT-MIGRATION] ✅ Canais padrão criados (geral, ti, rh, comercial, financeiro, pcp)');
    }

    console.log('[CHAT-MIGRATION] ✅ Migração do chat concluída com sucesso!');
}

module.exports = { createChatTables };
