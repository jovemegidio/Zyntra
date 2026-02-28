const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '@dminalu',
    database: 'aluforce_vendas',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });

  try {
    const email = 'comercial.test@local';
    const [rows] = await pool.query('SELECT id, email FROM usuarios WHERE email = ?', [email]);
    if (rows.length === 0) {
      console.log('Usuário não encontrado:', email);
      process.exit(0);
    }

    const id = rows[0].id;
    await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
    console.log('Removido usuário:', email, 'id:', id);
  } catch (err) {
    console.error('Erro ao remover usuário:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
