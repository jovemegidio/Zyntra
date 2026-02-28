/**
 * Migration: Adicionar campos PIX e remover agência/conta_corrente
 * Data: 2026-01-12
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
        port: parseInt(process.env.DB_PORT || '19396'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: process.env.DB_NAME || 'railway',
        waitForConnections: true,
        connectionLimit: 5
    });
    
    try {
        console.log('🔄 Iniciando migration: Adicionar campos PIX...\n');
        
        // Verificar se os novos campos já existem
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_NAME = 'funcionarios'
            AND COLUMN_NAME IN ('tipo_chave_pix', 'chave_pix')
        `, [process.env.DB_NAME || 'railway']);
        
        const existingCols = columns.map(c => c.COLUMN_NAME);
        
        if (existingCols.includes('tipo_chave_pix') && existingCols.includes('chave_pix')) {
            console.log('✅ Campos PIX já existem na tabela funcionarios');
        } else {
            // Adicionar novos campos se não existirem
            if (!existingCols.includes('tipo_chave_pix')) {
                console.log('➕ Adicionando coluna tipo_chave_pix...');
                await pool.query(`
                    ALTER TABLE funcionarios 
                    ADD COLUMN tipo_chave_pix ENUM('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') NULL AFTER banco
                `);
            }
            
            if (!existingCols.includes('chave_pix')) {
                console.log('➕ Adicionando coluna chave_pix...');
                await pool.query(`
                    ALTER TABLE funcionarios 
                    ADD COLUMN chave_pix VARCHAR(255) NULL AFTER tipo_chave_pix
                `);
            }
            
            console.log('✅ Campos PIX adicionados com sucesso!');
        }
        
        // Verificar se existem dados em agência e conta_corrente
        const [dadosBancarios] = await pool.query(`
            SELECT COUNT(*) as total FROM funcionarios 
            WHERE agencia IS NOT NULL AND agencia != '' 
            OR conta_corrente IS NOT NULL AND conta_corrente != ''
        `);
        
        if (dadosBancarios[0].total > 0) {
            console.log(`\n⚠️  Existem ${dadosBancarios[0].total} registros com dados de agência/conta.`);
            console.log('   Os campos serão mantidos, mas não serão mais usados na interface.\n');
        }
        
        console.log('✅ Migration concluída com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro na migration:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

migrate().then(() => {
    console.log('\n🎉 Processo finalizado!');
    process.exit(0);
}).catch(err => {
    console.error('\n💥 Falha na migration:', err);
    process.exit(1);
});
