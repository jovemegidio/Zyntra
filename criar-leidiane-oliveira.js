// criar-leidiane-oliveira.js
// Cadastra a usuaria Melissa com acesso a Vendas (funcionario) e RH (funcionario)
// Executar na VPS: node criar-leidiane-oliveira.js

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'aluforce',
    password: 'Aluforce2026VpsDB',
    database: 'aluforce_vendas'
  });

  try {
    const email = 'representantes@aluforce.ind.br';
    const nome = 'Melissa';
    const senha = 'alu0103';

    // 1. Verificar se já existe
    const [existing] = await conn.query(
      'SELECT id, email FROM usuarios WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      console.log('✅ Usuária já existe:', existing[0]);
      await conn.end();
      return;
    }

    // 2. Gerar hash da senha
    const hash = await bcrypt.hash(senha, 10);

    // 3. Inserir usuária
    const [result] = await conn.query(
      `INSERT INTO usuarios (nome, email, senha_hash, password_hash, ativo, status, role, setor, departamento)
       VALUES (?, ?, ?, ?, 1, 'ativo', 'user', 'vendas', 'Vendas')`,
      [nome, email, hash, hash]
    );

    console.log(`✅ Usuária criada com sucesso! ID: ${result.insertId}`);
    console.log(`   Nome: ${nome}`);
    console.log(`   Email: ${email}`);
    console.log(`   Senha: ${senha}`);
    console.log(`   Acesso: Vendas (funcionário) + RH (funcionário)`);
  } catch (err) {
    console.error('❌ Erro ao criar usuária:', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
