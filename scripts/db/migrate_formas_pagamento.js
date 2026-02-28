/**
 * Script de migração para garantir que a tabela formas_pagamento 
 * tenha todas as colunas necessárias
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
        console.log('🔧 Iniciando migração de formas_pagamento...');

        // Verificar se a tabela existe
        const [tables] = await pool.query(
            "SHOW TABLES LIKE 'formas_pagamento'"
        );

        if (tables.length === 0) {
            console.log('📦 Criando tabela formas_pagamento...');
            await pool.query(`
                CREATE TABLE formas_pagamento (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nome VARCHAR(100) NOT NULL,
                    tipo VARCHAR(50) DEFAULT 'a_vista',
                    icone VARCHAR(50) DEFAULT 'fa-money-bill-wave',
                    prazo INT DEFAULT 0,
                    taxa DECIMAL(5,2) DEFAULT 0.00,
                    status VARCHAR(20) DEFAULT 'ativo',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ Tabela criada com sucesso!');

            // Inserir dados padrão
            console.log('📝 Inserindo formas de pagamento padrão...');
            await pool.query(`
                INSERT INTO formas_pagamento (nome, tipo, icone, prazo, taxa, status) VALUES
                ('Dinheiro', 'a_vista', 'fa-money-bill-wave', 0, 0.00, 'ativo'),
                ('Cartão de Crédito', 'parcelado', 'fa-credit-card', 30, 3.50, 'ativo'),
                ('PIX', 'a_vista', 'fa-qrcode', 0, 0.00, 'ativo'),
                ('Boleto', 'a_prazo', 'fa-barcode', 28, 2.50, 'ativo'),
                ('Transferência Bancária', 'a_vista', 'fa-exchange-alt', 0, 0.00, 'ativo'),
                ('Cheque', 'a_prazo', 'fa-file-invoice-dollar', 30, 1.00, 'ativo')
            `);
            console.log('✅ Dados padrão inseridos!');
        } else {
            console.log('📋 Tabela já existe. Verificando colunas...');

            // Verificar e adicionar colunas que possam estar faltando
            const [columns] = await pool.query(
                "SHOW COLUMNS FROM formas_pagamento"
            );
            const colNames = columns.map(c => c.Field);

            if (!colNames.includes('prazo')) {
                console.log('  ➕ Adicionando coluna prazo...');
                await pool.query("ALTER TABLE formas_pagamento ADD COLUMN prazo INT DEFAULT 0");
            }

            if (!colNames.includes('taxa')) {
                console.log('  ➕ Adicionando coluna taxa...');
                await pool.query("ALTER TABLE formas_pagamento ADD COLUMN taxa DECIMAL(5,2) DEFAULT 0.00");
            }

            if (!colNames.includes('status')) {
                console.log('  ➕ Adicionando coluna status...');
                await pool.query("ALTER TABLE formas_pagamento ADD COLUMN status VARCHAR(20) DEFAULT 'ativo'");
            }

            if (!colNames.includes('tipo')) {
                console.log('  ➕ Adicionando coluna tipo...');
                await pool.query("ALTER TABLE formas_pagamento ADD COLUMN tipo VARCHAR(50) DEFAULT 'a_vista'");
            }

            if (!colNames.includes('icone')) {
                console.log('  ➕ Adicionando coluna icone...');
                await pool.query("ALTER TABLE formas_pagamento ADD COLUMN icone VARCHAR(50) DEFAULT 'fa-money-bill-wave'");
            }

            console.log('✅ Colunas verificadas!');

            // Verificar se tem dados
            const [count] = await pool.query("SELECT COUNT(*) as total FROM formas_pagamento");
            if (count[0].total === 0) {
                console.log('📝 Inserindo formas de pagamento padrão...');
                await pool.query(`
                    INSERT INTO formas_pagamento (nome, tipo, icone, prazo, taxa, status) VALUES
                    ('Dinheiro', 'a_vista', 'fa-money-bill-wave', 0, 0.00, 'ativo'),
                    ('Cartão de Crédito', 'parcelado', 'fa-credit-card', 30, 3.50, 'ativo'),
                    ('PIX', 'a_vista', 'fa-qrcode', 0, 0.00, 'ativo'),
                    ('Boleto', 'a_prazo', 'fa-barcode', 28, 2.50, 'ativo'),
                    ('Transferência Bancária', 'a_vista', 'fa-exchange-alt', 0, 0.00, 'ativo')
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
