// Reset ALL passwords to alu0103
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

    const newPassword = 'alu0103';
    const hash = await bcrypt.hash(newPassword, 12);
    
    console.log('Nova senha:', newPassword);
    console.log('Hash gerado:', hash);
    
    // Update both senha_hash and password_hash for ALL users
    const [result] = await pool.query(
        'UPDATE usuarios SET senha_hash = ?, password_hash = ?',
        [hash, hash]
    );
    
    console.log('Usuarios atualizados:', result.affectedRows);
    
    // Verify
    const verify = await bcrypt.compare(newPassword, hash);
    console.log('Verificacao bcrypt:', verify);
    
    // List updated users
    const [users] = await pool.query('SELECT id, email, nome FROM usuarios ORDER BY id');
    console.log('\nUsuarios com senha resetada:');
    users.forEach(u => console.log('  ', u.id, u.email, '-', u.nome));
    console.log('\nTotal:', users.length, 'usuarios');
    
    await pool.end();
    console.log('\nDone!');
    process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
