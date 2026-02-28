const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'aluforce',
    password: 'Aluforce2026VpsDB',
    database: 'aluforce_vendas'
  });

  // 1. Buscar Hellen e Tatiane na tabela usuarios
  console.log('=== USUARIOS ===');
  const [users] = await conn.query(
    `SELECT id, nome, email, role, is_admin, areas, departamento, ativo, status 
     FROM usuarios 
     WHERE email LIKE '%hellen%' OR email LIKE '%tatiane%' OR nome LIKE '%Tatiane%'`
  );
  console.table(users);

  // 2. Buscar na tabela funcionarios tambem
  console.log('\n=== FUNCIONARIOS ===');
  const [funcs] = await conn.query(
    `SELECT id, nome, email, cargo, departamento, ativo 
     FROM funcionarios 
     WHERE email LIKE '%hellen%' OR email LIKE '%tatiane%' OR nome LIKE '%Tatiane%'`
  );
  console.table(funcs);

  // 3. Verificar permissoes existentes
  const userIds = users.map(u => u.id);
  if (userIds.length > 0) {
    console.log('\n=== PERMISSOES_MODULOS ===');
    const [perms] = await conn.query(
      `SELECT * FROM permissoes_modulos WHERE usuario_id IN (?)`, [userIds]
    );
    console.table(perms);
  }

  // 4. Verificar tabela permissoes_modulos - quais modulos existem
  console.log('\n=== MODULOS DISTINTOS ===');
  const [mods] = await conn.query(`SELECT DISTINCT modulo FROM permissoes_modulos`);
  console.table(mods);

  // 5. Verificar exemplo de admin (ti@) para comparar
  console.log('\n=== EXEMPLO ADMIN (ti) ===');
  const [adminPerms] = await conn.query(
    `SELECT pm.* FROM permissoes_modulos pm 
     JOIN usuarios u ON pm.usuario_id = u.id 
     WHERE u.email = 'ti@aluforce.ind.br'`
  );
  console.table(adminPerms);

  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
