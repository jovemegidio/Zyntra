// Testa login dos usuarios pendentes no relatorio
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const fs = require('fs');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'aluforce',
    password: 'Aluforce2026VpsDB',
    database: 'aluforce_vendas'
  });

  const envContent = fs.readFileSync('/var/www/aluforce/.env', 'utf8');
  const jwtSecretMatch = envContent.match(/JWT_SECRET=(.+)/);
  const JWT_SECRET = jwtSecretMatch ? jwtSecretMatch[1].trim() : null;
  const PASSWORD = 'alu0103';

  // Buscar usuarios pendentes por nome/email parcial
  const pendentes = [
    'angelica', 'tatiane', 'joao.vitor', 'sergio.belizario',
    'isabela.oliveira', 'daniel.brito', 'daniel'
  ];

  console.log('='.repeat(90));
  console.log('TESTE DE USUARIOS PENDENTES - ' + new Date().toISOString());
  console.log('='.repeat(90));

  // Primeiro: buscar todos os que batem
  for (const termo of pendentes) {
    const [rows] = await conn.query(
      'SELECT id, email, nome, ativo, status, senha_hash, password_hash FROM usuarios WHERE email LIKE ? OR nome LIKE ?',
      [`%${termo}%`, `%${termo}%`]
    );
    if (rows.length === 0) {
      console.log(`\n❌ "${termo}" - NAO ENCONTRADO no banco de dados`);
    } else {
      for (const u of rows) {
        const hash = u.senha_hash || u.password_hash;
        let bcryptOk = false;
        try { bcryptOk = hash ? await bcrypt.compare(PASSWORD, hash) : false; } catch(e) {}
        
        const isActive = u.ativo === 1 || u.ativo === '1';
        console.log(`\n✅ "${termo}" ENCONTRADO:`);
        console.log(`   ID: ${u.id} | Email: ${u.email} | Nome: ${u.nome}`);
        console.log(`   Ativo: ${u.ativo} | Status: ${u.status} | Bcrypt: ${bcryptOk ? 'OK' : 'FALHOU'}`);

        if (isActive && bcryptOk && JWT_SECRET) {
          const token = jwt.sign(
            { id: u.id, email: u.email },
            JWT_SECRET,
            { expiresIn: '1h', audience: 'aluforce' }
          );
          try {
            const me = await new Promise((resolve, reject) => {
              const req = http.request('http://localhost:3000/api/me', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
              }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => resolve({ status: res.statusCode, body }));
              });
              req.on('error', reject);
              req.end();
            });
            console.log(`   /api/me: ${me.status} ${me.status === 200 ? '✅ OK' : '⚠️ ' + me.body.substring(0, 80)}`);
          } catch(err) {
            console.log(`   /api/me: ERR ❌ ${err.message}`);
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(90));
  
  // Total de usuarios no banco
  const [total] = await conn.query('SELECT COUNT(*) as total FROM usuarios');
  const [ativos] = await conn.query('SELECT COUNT(*) as total FROM usuarios WHERE ativo = 1');
  const [inativos] = await conn.query('SELECT COUNT(*) as total FROM usuarios WHERE ativo = 0');
  console.log(`TOTAL BANCO: ${total[0].total} | Ativos: ${ativos[0].total} | Inativos: ${inativos[0].total}`);
  console.log('='.repeat(90));

  await conn.end();
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
