// Check user credentials in DB
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    
    // Check columns first
    const [cols] = await pool.query('SHOW COLUMNS FROM usuarios');
    console.log('Columns:', cols.map(c => c.Field).join(', '));
    
    // Check TI user
    const [rows] = await pool.query(
        'SELECT id, email, nome, senha_hash, senha FROM usuarios WHERE email LIKE ? LIMIT 3',
        ['ti@%']
    );
    
    rows.forEach(r => {
        console.log('\nUser:', r.email, '| Nome:', r.nome, '| ID:', r.id);
        if (r.senha_hash) console.log('  senha_hash prefix:', r.senha_hash.substring(0, 20));
        if (r.senha) console.log('  senha prefix:', String(r.senha).substring(0, 20));
    });
    
    // Also check a known working user
    const [rows2] = await pool.query(
        'SELECT id, email, nome FROM usuarios WHERE status != "demitido" AND status != "inativo" LIMIT 5'
    );
    console.log('\nFirst 5 active users:');
    rows2.forEach(r => console.log(' ', r.id, r.email, r.nome));
    
    await pool.end();
})().catch(e => console.error('ERROR:', e.message));
