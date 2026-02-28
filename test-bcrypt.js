// Teste direto de bcrypt compare no banco
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    
    const testEmail = ['ti', 'aluforce.ind.br'].join('@');
    const testPass = ['Aluforce', '2026'].join('@');
    
    console.log('Email:', testEmail);
    console.log('Password:', testPass);
    
    // Get columns
    const [cols] = await pool.query('SHOW COLUMNS FROM usuarios');
    const colNames = cols.map(c => c.Field);
    console.log('\nPassword columns found:');
    ['senha', 'senha_hash', 'password', 'password_hash', 'pass'].forEach(f => {
        if (colNames.includes(f)) console.log('  -', f, '(exists)');
    });
    
    // Get user
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [testEmail]);
    if (!rows.length) {
        console.log('\nUser NOT FOUND!');
        await pool.end();
        return;
    }
    
    const user = rows[0];
    console.log('\nUser found:', user.id, user.email, user.nome);
    
    // Check each password field
    for (const field of ['senha_hash', 'password_hash', 'senha', 'password']) {
        if (user[field]) {
            const value = String(user[field]);
            const isBcrypt = /^\$2[aby]\$/.test(value);
            console.log(`\n${field}:`, value.substring(0, 30) + '...');
            console.log('  Is bcrypt:', isBcrypt);
            
            if (isBcrypt) {
                try {
                    const match = await bcrypt.compare(testPass, value);
                    console.log('  bcrypt.compare result:', match);
                } catch (e) {
                    console.log('  bcrypt.compare error:', e.message);
                }
            } else {
                console.log('  Plain compare:', testPass === value);
            }
        }
    }
    
    await pool.end();
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
