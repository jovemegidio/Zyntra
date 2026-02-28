/**
 * ALUFORCE v2.0 — Enterprise Startup Tables Migration
 * 
 * Centralizes ALL CREATE TABLE IF NOT EXISTS statements that were 
 * previously scattered across route handlers.
 * 
 * This runs ONCE at startup (idempotent) instead of on every HTTP request.
 * 
 * @module database/migrations/startup-tables-enterprise
 */
'use strict';

async function runEnterpriseMigrations(pool) {
    if (!pool) return;
    
    const startTime = Date.now();
    console.log('[MIGRATION] 🚀 Executando migrações enterprise...');
    
    const tables = [
        // ── Configurações ────────────────────────────────
        {
            name: 'configuracoes_empresa',
            sql: `CREATE TABLE IF NOT EXISTS configuracoes_empresa (
                id INT PRIMARY KEY AUTO_INCREMENT,
                razao_social VARCHAR(255),
                nome_fantasia VARCHAR(255),
                cnpj VARCHAR(18),
                inscricao_estadual VARCHAR(50),
                inscricao_municipal VARCHAR(50),
                telefone VARCHAR(20),
                email VARCHAR(100),
                site VARCHAR(255),
                cep VARCHAR(10),
                estado VARCHAR(2),
                cidade VARCHAR(100),
                bairro VARCHAR(100),
                endereco VARCHAR(255),
                numero VARCHAR(20),
                complemento VARCHAR(100),
                logo_url VARCHAR(500),
                favicon_url VARCHAR(500),
                cor_primaria VARCHAR(7) DEFAULT '#1a73e8',
                cor_secundaria VARCHAR(7) DEFAULT '#174ea6',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'configuracoes_venda_produtos',
            sql: `CREATE TABLE IF NOT EXISTS configuracoes_venda_produtos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                valor TEXT,
                tipo VARCHAR(20) DEFAULT 'texto',
                grupo VARCHAR(50) DEFAULT 'geral',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'configuracoes_venda_servicos',
            sql: `CREATE TABLE IF NOT EXISTS configuracoes_venda_servicos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                valor TEXT,
                tipo VARCHAR(20) DEFAULT 'texto',
                grupo VARCHAR(50) DEFAULT 'geral',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'configuracoes_clientes_fornecedores',
            sql: `CREATE TABLE IF NOT EXISTS configuracoes_clientes_fornecedores (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                valor TEXT,
                tipo VARCHAR(20) DEFAULT 'texto',
                grupo VARCHAR(50) DEFAULT 'geral',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'configuracoes_financas',
            sql: `CREATE TABLE IF NOT EXISTS configuracoes_financas (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                valor TEXT,
                tipo VARCHAR(20) DEFAULT 'texto',
                grupo VARCHAR(50) DEFAULT 'geral',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'configuracoes_impostos',
            sql: `CREATE TABLE IF NOT EXISTS configuracoes_impostos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                tipo VARCHAR(50) NOT NULL,
                nome VARCHAR(100) NOT NULL,
                aliquota DECIMAL(10,4) DEFAULT 0,
                incidencia VARCHAR(50) DEFAULT 'produto',
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        
        // ── PCP ──────────────────────────────────────────
        {
            name: 'pcp_etapas_processo',
            sql: `CREATE TABLE IF NOT EXISTS pcp_etapas_processo (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                descricao TEXT,
                ordem INT DEFAULT 0,
                cor VARCHAR(7) DEFAULT '#4CAF50',
                icone VARCHAR(50),
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'familias_produtos',
            sql: `CREATE TABLE IF NOT EXISTS familias_produtos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                descricao TEXT,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'caracteristicas_produtos',
            sql: `CREATE TABLE IF NOT EXISTS caracteristicas_produtos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                tipo VARCHAR(50) DEFAULT 'texto',
                opcoes TEXT,
                obrigatoria TINYINT(1) DEFAULT 0,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'maquinas_producao',
            sql: `CREATE TABLE IF NOT EXISTS maquinas_producao (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                codigo VARCHAR(50),
                tipo VARCHAR(50),
                status ENUM('ativa','manutencao','inativa') DEFAULT 'ativa',
                localizacao VARCHAR(100),
                capacidade_hora DECIMAL(10,2),
                ultima_manutencao DATE,
                proxima_manutencao DATE,
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'historico_manutencoes',
            sql: `CREATE TABLE IF NOT EXISTS historico_manutencoes (
                id INT PRIMARY KEY AUTO_INCREMENT,
                maquina_id INT NOT NULL,
                tipo VARCHAR(50),
                descricao TEXT,
                custo DECIMAL(10,2),
                data_inicio DATE,
                data_fim DATE,
                responsavel VARCHAR(100),
                status VARCHAR(50) DEFAULT 'concluida',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_maquina (maquina_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'gestao_producao',
            sql: `CREATE TABLE IF NOT EXISTS gestao_producao (
                id INT PRIMARY KEY AUTO_INCREMENT,
                tipo VARCHAR(50) NOT NULL,
                descricao TEXT,
                valor TEXT,
                status VARCHAR(50) DEFAULT 'ativo',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'anexos_ordem_producao',
            sql: `CREATE TABLE IF NOT EXISTS anexos_ordem_producao (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ordem_producao_id INT NOT NULL,
                nome VARCHAR(255) NOT NULL,
                caminho VARCHAR(500) NOT NULL,
                tipo VARCHAR(50),
                tamanho INT,
                usuario_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ordem (ordem_producao_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'historico_ordem_producao',
            sql: `CREATE TABLE IF NOT EXISTS historico_ordem_producao (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ordem_producao_id INT NOT NULL,
                tipo VARCHAR(50) NOT NULL,
                descricao TEXT,
                usuario_id INT,
                dados_anteriores JSON,
                dados_novos JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ordem_data (ordem_producao_id, created_at DESC)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'tarefas_ordem_producao',
            sql: `CREATE TABLE IF NOT EXISTS tarefas_ordem_producao (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ordem_producao_id INT NOT NULL,
                titulo VARCHAR(255) NOT NULL,
                descricao TEXT,
                responsavel_id INT,
                prioridade ENUM('baixa','media','alta','urgente') DEFAULT 'media',
                status ENUM('pendente','em_andamento','concluida','cancelada') DEFAULT 'pendente',
                data_prazo DATE,
                data_conclusao DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_ordem (ordem_producao_id),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'apontamentos_producao',
            sql: `CREATE TABLE IF NOT EXISTS apontamentos_producao (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ordem_producao_id INT NOT NULL,
                operador_id INT,
                maquina_id INT,
                etapa VARCHAR(100),
                quantidade_produzida DECIMAL(10,2) DEFAULT 0,
                quantidade_refugo DECIMAL(10,2) DEFAULT 0,
                data_inicio DATETIME,
                data_fim DATETIME,
                tempo_parada_min INT DEFAULT 0,
                motivo_parada VARCHAR(255),
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ordem (ordem_producao_id),
                INDEX idx_operador_data (operador_id, data_inicio)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        
        // ── Vendas/Cadastros ─────────────────────────────
        {
            name: 'vendedores',
            sql: `CREATE TABLE IF NOT EXISTS vendedores (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                telefone VARCHAR(20),
                comissao_padrao DECIMAL(5,2) DEFAULT 0,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'compradores',
            sql: `CREATE TABLE IF NOT EXISTS compradores (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                telefone VARCHAR(20),
                departamento VARCHAR(100),
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'permissoes_modulos',
            sql: `CREATE TABLE IF NOT EXISTS permissoes_modulos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                usuario_id INT NOT NULL,
                modulo VARCHAR(50) NOT NULL,
                permissao VARCHAR(50) NOT NULL,
                concedido_por INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_usuario_modulo_perm (usuario_id, modulo, permissao)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'ordens_multiplexado',
            sql: `CREATE TABLE IF NOT EXISTS ordens_multiplexado (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ordem_producao_id INT NOT NULL,
                sequencia INT DEFAULT 1,
                tipo VARCHAR(50),
                dados JSON,
                status VARCHAR(50) DEFAULT 'pendente',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ordem (ordem_producao_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        
        // ── Financeiro ───────────────────────────────────
        {
            name: 'logs_integracao_financeiro',
            sql: `CREATE TABLE IF NOT EXISTS logs_integracao_financeiro (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tipo_origem ENUM('compra', 'venda', 'manual') NOT NULL,
                origem_id INT NULL,
                tipo_destino ENUM('conta_pagar', 'conta_receber') NOT NULL,
                destino_id INT NULL,
                valor DECIMAL(15,2) NOT NULL,
                usuario_id INT NULL,
                status ENUM('sucesso', 'erro') DEFAULT 'sucesso',
                mensagem TEXT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_origem (tipo_origem, origem_id),
                INDEX idx_destino (tipo_destino, destino_id),
                INDEX idx_data (criado_em)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        }
    ];

    let created = 0;
    let existed = 0;
    
    for (const table of tables) {
        try {
            await pool.query(table.sql);
            created++;
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                existed++;
            } else {
                console.warn(`[MIGRATION] ⚠️ Erro ao criar ${table.name}:`, err.message);
            }
        }
    }

    // ── Run performance indexes ──────────────────────────
    try {
        const indexMigration = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'migrations', '20260215_performance_indexes.sql'),
            'utf8'
        );
        
        // Split by semicolons and execute each statement
        const statements = indexMigration
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 10 && !s.startsWith('--') && !s.startsWith('SELECT'));
        
        let indexesCreated = 0;
        for (const stmt of statements) {
            try {
                // Convert "CREATE INDEX IF NOT EXISTS idx ON table (...)" to MySQL-compatible
                let execStmt = stmt;
                const createIdxMatch = stmt.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+ON\s+(\S+)\s*\((.+)\)/is);
                if (createIdxMatch) {
                    const [, idxName, tableName, columns] = createIdxMatch;
                    // Use ALTER TABLE ADD INDEX ... which ignores duplicate via handler
                    try {
                        await pool.query(`ALTER TABLE ${tableName} ADD INDEX ${idxName} (${columns})`);
                        indexesCreated++;
                    } catch (idxErr) {
                        if (idxErr.code === 'ER_DUP_KEYNAME' || idxErr.message?.includes('Duplicate')) {
                            indexesCreated++; // Already exists = ok
                        }
                        // Skip if table doesn't exist
                    }
                    continue;
                }
                await pool.query(execStmt);
                indexesCreated++;
            } catch (err) {
                // Ignore duplicate index errors or missing tables
                if (!err.message?.includes('Duplicate') && !err.message?.includes('exists')) {
                    // Silently skip - table might not exist yet
                }
            }
        }
        console.log(`[MIGRATION] 📊 ${indexesCreated} performance indexes verificados`);
    } catch (err) {
        console.warn('[MIGRATION] ⚠️ Performance indexes não aplicados:', err.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[MIGRATION] ✅ Enterprise migrations: ${created} tables, ${elapsed}ms`);
}

module.exports = { runEnterpriseMigrations };
