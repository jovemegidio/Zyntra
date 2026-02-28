const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'aluforce',
    password: 'Aluforce2026VpsDB',
    database: 'aluforce_vendas'
  });

  console.log('='.padEnd(80, '='));
  console.log('CONFIGURAÇÃO DE PERMISSÕES - HELLEN E TATIANE');
  console.log('='.padEnd(80, '='));

  // ============================================================
  // 1. HELLEN (usuario_id = 18)
  // Já existe. Remover módulos extras e deixar SOMENTE financeiro + rh
  // ============================================================
  console.log('\n--- HELLEN (usuario_id=18) ---');

  // Remover permissoes que NÃO são financeiro ou rh
  const [delResult] = await conn.query(
    `DELETE FROM permissoes_modulos 
     WHERE usuario_id = 18 AND modulo NOT IN ('financeiro', 'rh')`
  );
  console.log(`✅ Removidas ${delResult.affectedRows} permissões extras (compras, nfe, vendas)`);

  // Atualizar areas JSON no usuario
  await conn.query(
    `UPDATE usuarios 
     SET areas = '["financeiro", "rh"]'
     WHERE id = 18`
  );
  console.log('✅ areas atualizado para ["financeiro", "rh"]');

  // Verificar resultado
  const [hellenPerms] = await conn.query(
    `SELECT modulo, visualizar, criar, editar, excluir, aprovar 
     FROM permissoes_modulos WHERE usuario_id = 18 ORDER BY modulo`
  );
  console.log('Permissões finais Hellen:');
  console.table(hellenPerms);

  // ============================================================
  // 2. TATIANE (não existe em usuarios, apenas em funcionarios id=43)
  // Criar em usuarios + adicionar permissões financeiro + rh
  // ============================================================
  console.log('\n--- TATIANE ---');

  // Hash da senha padrão alu0103
  const senhaHash = await bcrypt.hash('alu0103', 12);

  // Criar em usuarios
  const [insertResult] = await conn.query(
    `INSERT INTO usuarios 
     (nome, email, senha_hash, password_hash, role, areas, departamento, setor, ativo, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'Tatiane Ribeiro Sousa',
      'tatiane.sousa@aluforce.ind.br',
      senhaHash,
      senhaHash,
      'user',
      '["financeiro", "rh"]',
      'Financeiro',
      'Financeiro',
      1,
      'ativo'
    ]
  );
  const tatianeId = insertResult.insertId;
  console.log(`✅ Tatiane criada em usuarios com id=${tatianeId}`);

  // Adicionar permissões: financeiro (visualizar, criar, editar) + rh (somente visualizar)
  await conn.query(
    `INSERT INTO permissoes_modulos (usuario_id, modulo, visualizar, criar, editar, excluir, aprovar)
     VALUES 
       (?, 'financeiro', 1, 1, 1, 0, 0),
       (?, 'rh', 1, 0, 0, 0, 0)`,
    [tatianeId, tatianeId]
  );
  console.log('✅ Permissões adicionadas: financeiro (ver/criar/editar) + rh (ver)');

  // Verificar resultado
  const [tatianePerms] = await conn.query(
    `SELECT modulo, visualizar, criar, editar, excluir, aprovar 
     FROM permissoes_modulos WHERE usuario_id = ? ORDER BY modulo`,
    [tatianeId]
  );
  console.log('Permissões finais Tatiane:');
  console.table(tatianePerms);

  // ============================================================
  // 3. VERIFICAÇÃO FINAL
  // ============================================================
  console.log('\n' + '='.padEnd(80, '='));
  console.log('VERIFICAÇÃO FINAL');
  console.log('='.padEnd(80, '='));

  const [final] = await conn.query(
    `SELECT u.id, u.nome, u.email, u.areas, u.ativo,
            GROUP_CONCAT(pm.modulo ORDER BY pm.modulo) AS modulos_permitidos
     FROM usuarios u
     LEFT JOIN permissoes_modulos pm ON pm.usuario_id = u.id AND pm.visualizar = 1
     WHERE u.id IN (18, ?)
     GROUP BY u.id`,
    [tatianeId]
  );
  console.table(final);

  // 4. Testar login da Tatiane
  console.log('\n--- TESTE BCRYPT TATIANE ---');
  const [tatianeUser] = await conn.query(
    `SELECT senha_hash FROM usuarios WHERE id = ?`, [tatianeId]
  );
  const match = await bcrypt.compare('alu0103', tatianeUser[0].senha_hash);
  console.log(`Senha 'alu0103' match: ${match ? '✅ OK' : '❌ FALHOU'}`);

  await conn.end();
  console.log('\n✅ CONCLUÍDO!');
}

main().catch(err => { console.error('ERRO:', err); process.exit(1); });
