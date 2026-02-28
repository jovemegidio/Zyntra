/**
 * Script de migração para garantir que a tabela categorias_financeiras 
 * tenha o campo pai_id para suporte a subcontas
 */

const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '@Web100O0!',
        database: process.env.DB_NAME || 'aluforce',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        console.log('🔧 Iniciando migração de categorias_financeiras...');

        // Verificar se a tabela existe
        const [tables] = await pool.query(
            "SHOW TABLES LIKE 'categorias_financeiras'"
        );

        if (tables.length === 0) {
            console.log('📦 Criando tabela categorias_financeiras...');
            await pool.query(`
                CREATE TABLE categorias_financeiras (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nome VARCHAR(100) NOT NULL,
                    tipo ENUM('receita', 'despesa', 'ambos') NOT NULL DEFAULT 'despesa',
                    cor VARCHAR(20) DEFAULT '#3b82f6',
                    icone VARCHAR(50) DEFAULT 'fa-folder',
                    orcamento_mensal DECIMAL(15,2) DEFAULT 0.00,
                    descricao TEXT,
                    pai_id INT DEFAULT NULL,
                    ativo TINYINT(1) DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (pai_id) REFERENCES categorias_financeiras(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ Tabela criada com sucesso!');

            // Inserir dados padrão
            console.log('📝 Inserindo categorias padrão...');
            await pool.query(`
                INSERT INTO categorias_financeiras (nome, tipo, cor, icone, pai_id) VALUES
                ('Receitas Operacionais', 'receita', '#22c55e', 'fa-chart-line', NULL),
                ('Vendas de Produtos', 'receita', '#22c55e', 'fa-shopping-cart', 1),
                ('Vendas de Serviços', 'receita', '#22c55e', 'fa-tools', 1),
                ('Receitas Financeiras', 'receita', '#3b82f6', 'fa-money-bill', NULL),
                ('Juros Recebidos', 'receita', '#3b82f6', 'fa-percentage', 4),
                ('Despesas Operacionais', 'despesa', '#ef4444', 'fa-building', NULL),
                ('Salários e Encargos', 'despesa', '#ef4444', 'fa-users', 6),
                ('Aluguel', 'despesa', '#ef4444', 'fa-home', 6),
                ('Energia Elétrica', 'despesa', '#f59e0b', 'fa-bolt', 6),
                ('Água e Esgoto', 'despesa', '#3b82f6', 'fa-tint', 6),
                ('Despesas Administrativas', 'despesa', '#8b5cf6', 'fa-folder', NULL),
                ('Material de Escritório', 'despesa', '#8b5cf6', 'fa-pen', 11),
                ('Internet e Telefone', 'despesa', '#8b5cf6', 'fa-wifi', 11)
            `);
            console.log('✅ Dados padrão inseridos!');
        } else {
            console.log('📋 Tabela já existe. Verificando colunas...');

            // Verificar e adicionar colunas que possam estar faltando
            const [columns] = await pool.query(
                "SHOW COLUMNS FROM categorias_financeiras"
            );
            const colNames = columns.map(c => c.Field);

            if (!colNames.includes('pai_id')) {
                console.log('  ➕ Adicionando coluna pai_id...');
                await pool.query("ALTER TABLE categorias_financeiras ADD COLUMN pai_id INT DEFAULT NULL");
                console.log('  ✅ Coluna pai_id adicionada!');
            }

            if (!colNames.includes('cor')) {
                console.log('  ➕ Adicionando coluna cor...');
                await pool.query("ALTER TABLE categorias_financeiras ADD COLUMN cor VARCHAR(20) DEFAULT '#3b82f6'");
            }

            if (!colNames.includes('icone')) {
                console.log('  ➕ Adicionando coluna icone...');
                await pool.query("ALTER TABLE categorias_financeiras ADD COLUMN icone VARCHAR(50) DEFAULT 'fa-folder'");
            }

            if (!colNames.includes('orcamento_mensal')) {
                console.log('  ➕ Adicionando coluna orcamento_mensal...');
                await pool.query("ALTER TABLE categorias_financeiras ADD COLUMN orcamento_mensal DECIMAL(15,2) DEFAULT 0.00");
            }

            if (!colNames.includes('descricao')) {
                console.log('  ➕ Adicionando coluna descricao...');
                await pool.query("ALTER TABLE categorias_financeiras ADD COLUMN descricao TEXT");
            }

            if (!colNames.includes('ativo')) {
                console.log('  ➕ Adicionando coluna ativo...');
                await pool.query("ALTER TABLE categorias_financeiras ADD COLUMN ativo TINYINT(1) DEFAULT 1");
            }

            console.log('✅ Colunas verificadas!');

            // Verificar se tem dados
            const [count] = await pool.query("SELECT COUNT(*) as total FROM categorias_financeiras");
            if (count[0].total === 0) {
                console.log('📝 Inserindo categorias padrão...');
                await pool.query(`
                    INSERT INTO categorias_financeiras (nome, tipo, cor, icone, pai_id) VALUES
                    ('Receitas Operacionais', 'receita', '#22c55e', 'fa-chart-line', NULL),
                    ('Vendas de Produtos', 'receita', '#22c55e', 'fa-shopping-cart', 1),
                    ('Despesas Operacionais', 'despesa', '#ef4444', 'fa-building', NULL),
                    ('Salários e Encargos', 'despesa', '#ef4444', 'fa-users', 3)
                `);
                console.log('✅ Dados padrão inseridos!');
            }
        }

        console.log('\n🎉 Migração concluída com sucesso!');

    } catch (error) {
        console.error('❌ Erro na migração:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Executar se for chamado diretamente
if (require.main === module) {
    migrate()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = migrate;
