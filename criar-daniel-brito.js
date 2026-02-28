const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const http = require('http');
const fs = require('fs');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'aluforce',
    password: 'Aluforce2026VpsDB', database: 'aluforce_vendas'
  });

  // 1. Gerar hash
  const hash = await bcrypt.hash('alu0103', 10);
  console.log('Hash gerado:', hash);

  // 2. Verificar se ja existe
  const [existing] = await conn.query(
    "SELECT id, email FROM usuarios WHERE email = 'daniel.brito@aluforce.ind.br'"
  );
  
  if (existing.length > 0) {
    console.log('Usuario ja existe:', existing[0]);
    await conn.end();
    return;
  }

  // 3. Inserir
  const [result] = await conn.query(
    `INSERT INTO usuarios (email, nome, senha_hash, password_hash, ativo, status, role, setor)
     VALUES (?, ?, ?, ?, 1, 'ativo', 'user', 'producao')`,
    ['daniel.brito@aluforce.ind.br', 'Daniel Brito', hash, hash]
  );
  
  const newId = result.insertId;
  console.log('Usuario criado com ID:', newId);

  // 4. Testar login
  const envContent = fs.readFileSync('/var/www/aluforce/.env', 'utf8');
  const JWT_SECRET = envContent.match(/JWT_SECRET=(.+)/)[1].trim();
  
  const okBcrypt = await bcrypt.compare('alu0103', hash);
  console.log('Bcrypt verify:', okBcrypt);
  
  const token = jwt.sign(
    { id: newId, email: 'daniel.brito@aluforce.ind.br' },
    JWT_SECRET, { expiresIn: '1h', audience: 'aluforce' }
  );

  const me = await new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/me', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

  console.log('/api/me status:', me.status);
  console.log('RESULTADO:', me.status === 200 ? 'OK - Login funciona!' : 'FALHOU - ' + me.body);
  
  // 5. Contar totais
  const [total] = await conn.query('SELECT COUNT(*) as t FROM usuarios');
  const [ativos] = await conn.query("SELECT COUNT(*) as t FROM usuarios WHERE ativo=1");
  console.log('Total banco:', total[0].t, '| Ativos:', ativos[0].t);

  await conn.end();
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
