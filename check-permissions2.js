const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'aluforce',
    password: 'Aluforce2026VpsDB',
    database: 'aluforce_vendas'
  });

  // 1. Colunas da tabela funcionarios
  console.log('=== COLUNAS FUNCIONARIOS ===');
  const [cols] = await conn.query(`SHOW COLUMNS FROM funcionarios`);
  console.log(cols.map(c => c.Field).join(', '));

  // 2. Buscar Tatiane em funcionarios
  console.log('\n=== FUNCIONARIOS - TATIANE ===');
  const [funcs] = await conn.query(
    `SELECT * FROM funcionarios WHERE email LIKE '%tatiane%' LIMIT 5`
  );
  if (funcs.length > 0) {
    for (const f of funcs) {
      console.log(JSON.stringify(f, null, 2));
    }
  } else {
    console.log('Tatiane NAO encontrada em funcionarios');
  }

  // 3. Hellen - permissoes_modulos
  console.log('\n=== PERMISSOES HELLEN (usuario_id=18) ===');
  const [hellenPerms] = await conn.query(
    `SELECT * FROM permissoes_modulos WHERE usuario_id = 18`
  );
  console.table(hellenPerms);

  // 4. Modulos distintos
  console.log('\n=== MODULOS DISTINTOS ===');
  const [mods] = await conn.query(`SELECT DISTINCT modulo FROM permissoes_modulos ORDER BY modulo`);
  console.log(mods.map(m => m.modulo));

  // 5. Exemplo de permissao financeiro+rh de alguem
  console.log('\n=== EXEMPLO PERMISSAO FINANCEIRO ===');
  const [finPerms] = await conn.query(
    `SELECT pm.*, u.email FROM permissoes_modulos pm 
     JOIN usuarios u ON pm.usuario_id = u.id 
     WHERE pm.modulo = 'financeiro' LIMIT 5`
  );
  console.table(finPerms);

  // 6. Verificar se Tatiane existe como usuario
  console.log('\n=== BUSCA AMPLA TATIANE ===');
  const [tatUsers] = await conn.query(
    `SELECT id, email FROM usuarios WHERE nome LIKE '%tatiane%' OR nome LIKE '%Tatiane%' OR email LIKE '%tatiane%'`
  );
  console.log('Usuarios:', tatUsers);

  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
