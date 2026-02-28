const mysql = require('mysql2/promise');

async function verificar() {
    const pool = await mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway',
        port: 19396
    });

    try {
        const [columns] = await pool.query("DESCRIBE bancos");
        console.log('=== ESTRUTURA DA TABELA BANCOS ===');
        columns.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await pool.end();
    }
}

verificar();
