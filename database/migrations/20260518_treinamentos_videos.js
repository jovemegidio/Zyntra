/**
 * Migration: adiciona colunas de vídeo à tabela rh_treinamentos
 * e cria a tabela caso não exista.
 */
async function runMigration(pool) {
    const tag = '[TREINA-VIDEO]';
    try {
        // Garante que a tabela existe com estrutura mínima
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rh_treinamentos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                descricao TEXT,
                tipo VARCHAR(50) DEFAULT 'video',
                categoria VARCHAR(100),
                carga_horaria INT DEFAULT 0,
                instrutor VARCHAR(150),
                local_treinamento VARCHAR(255),
                data_inicio DATE,
                data_fim DATE,
                horario_inicio TIME,
                horario_fim TIME,
                vagas_totais INT DEFAULT 0,
                vagas_disponiveis INT DEFAULT 0,
                obrigatorio TINYINT(1) DEFAULT 0,
                departamentos_alvo JSON,
                status VARCHAR(50) DEFAULT 'publicado',
                criado_por INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        const addIfMissing = async (col, def) => {
            try {
                await pool.query(`ALTER TABLE rh_treinamentos ADD COLUMN ${col} ${def}`);
            } catch (e) {
                if (e.code !== 'ER_DUP_FIELDNAME' && !e.message.includes('Duplicate column')) throw e;
            }
        };

        await addIfMissing('video_path',     'VARCHAR(500)');
        await addIfMissing('video_nome',     'VARCHAR(255)');
        await addIfMissing('video_tamanho',  'BIGINT DEFAULT 0');
        await addIfMissing('video_mimetype', 'VARCHAR(100)');
        await addIfMissing('thumbnail_path', 'VARCHAR(500)');
        await addIfMissing('duracao',        'INT DEFAULT 0');
        await addIfMissing('status',         "VARCHAR(50) DEFAULT 'publicado'");
        await addIfMissing('visualizacoes',  'INT DEFAULT 0');

        // Tabela de progresso de visualização por funcionário
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rh_treinamentos_progresso (
                id INT AUTO_INCREMENT PRIMARY KEY,
                treinamento_id INT NOT NULL,
                funcionario_id INT,
                user_id INT,
                progresso INT DEFAULT 0,
                concluido TINYINT(1) DEFAULT 0,
                ultima_posicao INT DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_treina_user (treinamento_id, user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        console.log(`${tag} ✅ Migração de vídeos concluída`);
    } catch (err) {
        console.error(`${tag} ❌ Erro:`, err.message);
        throw err;
    }
}

module.exports = { runMigration };
