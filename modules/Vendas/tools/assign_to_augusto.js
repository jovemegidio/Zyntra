const mysql = require('mysql2/promise');

(async () => {
  const DB_CONFIG = {
    host: 'localhost',
    user: 'root',
    password: '@dminalu',
    database: 'aluforce_vendas'
  };
  const pool = await mysql.createPool(DB_CONFIG);
  try {
    const [users] = await pool.query('SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1', ['augusto.ladeira@aluforce.ind.br']);
    if (users.length === 0) {
      console.log('Usuário augusto não encontrado.');
      process.exit(0);
    }
    const augusto = users[0];
    const [result] = await pool.query('UPDATE pedidos SET vendedor_id = ? WHERE vendedor_id IS NULL OR vendedor_id = 0', [augusto.id]);
    console.log(`Pedidos atualizados: ${result.affectedRows}. Atribuídos ao usuário: ${augusto.nome} (id=${augusto.id})`);
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
