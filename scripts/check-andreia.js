const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function checkAndreia() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    
    const [rows] = await conn.execute(
        "SELECT id, nome, email, role FROM usuarios WHERE nome LIKE '%Andreia%' OR nome LIKE '%Andrea%' OR email LIKE '%andreia%'"
    );
    console.log('Usuários Andreia encontrados:', JSON.stringify(rows, null, 2));
    
    // Buscar todos os usuários que podem ter acesso ao Financeiro
    const [financeiroUsers] = await conn.execute(
        "SELECT id, nome, email, role FROM usuarios WHERE role IN ('admin', 'financeiro', 'consultoria')"
    );
    console.log('\nUsuários com roles admin/financeiro/consultoria:', JSON.stringify(financeiroUsers, null, 2));
    
    await conn.end();
}

checkAndreia().catch(console.error);
