// Testa login direto no banco, bypassing rate limiter
// Apenas para verificar que TODOS os usuarios conseguem autenticar
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');

const DB_CONFIG = {
  host: 'localhost',
  user: 'aluforce',
  password: 'Aluforce2026VpsDB',
  database: 'aluforce_vendas'
};

const PASSWORD = 'alu0103';

function httpGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:3000${path}`, {
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
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  
  // Buscar JWT_SECRET do .env
  const fs = require('fs');
  const envContent = fs.readFileSync('/var/www/aluforce/.env', 'utf8');
  const jwtSecretMatch = envContent.match(/JWT_SECRET=(.+)/);
  const JWT_SECRET = jwtSecretMatch ? jwtSecretMatch[1].trim() : null;
  
  if (!JWT_SECRET) {
    console.log('❌ JWT_SECRET não encontrado no .env');
    process.exit(1);
  }
  
  // Buscar todos usuarios
  const [users] = await conn.query(`
    SELECT id, email, nome, senha_hash, password_hash, ativo, status 
    FROM usuarios 
    ORDER BY id
  `);
  
  console.log('='.padEnd(100, '='));
  console.log(`TESTE COMPLETO - BYPASS RATE LIMITER - ${new Date().toISOString()}`);
  console.log(`Total: ${users.length} | Senha: ${PASSWORD}`);
  console.log('-'.padEnd(100, '-'));
  console.log(`${'ID'.padEnd(5)}${'EMAIL'.padEnd(46)}${'ATIVO'.padEnd(8)}${'BCRYPT'.padEnd(9)}${'/me'.padEnd(6)}RESULTADO`);
  console.log('-'.padEnd(100, '-'));
  
  const results = { ok: 0, blocked: 0, meErr: 0, bcryptFail: 0 };
  const errors = [];
  
  for (const user of users) {
    const hash = user.senha_hash || user.password_hash;
    const isActive = user.ativo === 1 || user.ativo === '1';
    const isBlocked = user.status === 'demitido' || user.status === 'inativo' || !isActive;
    
    // Test bcrypt
    let bcryptOk = false;
    try {
      bcryptOk = hash ? await bcrypt.compare(PASSWORD, hash) : false;
    } catch(e) {
      bcryptOk = false;
    }
    
    if (isBlocked) {
      console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}${String(user.ativo).padEnd(8)}${bcryptOk ? '✅' : '❌'}${' '.padEnd(8)}🚫 BLOQUEADO (${user.status || 'inativo'})`);
      results.blocked++;
      continue;
    }
    
    if (!bcryptOk) {
      console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}${String(user.ativo).padEnd(8)}❌${' '.padEnd(8)}❌ BCRYPT FALHOU`);
      results.bcryptFail++;
      errors.push({ email: user.email, issue: 'bcrypt failed' });
      continue;
    }
    
    // Gerar JWT manualmente para testar /api/me sem passar pelo rate limiter
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '1h', audience: 'aluforce' }
    );
    
    try {
      const me = await httpGet('/api/me', token);
      
      if (me.status === 200) {
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}${String(user.ativo).padEnd(8)}✅       200   ✅ OK`);
        results.ok++;
      } else {
        const bodySnippet = me.body.substring(0, 80);
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}${String(user.ativo).padEnd(8)}✅       ${me.status}   ⚠️ /me FALHOU: ${bodySnippet}`);
        results.meErr++;
        errors.push({ email: user.email, issue: `/me ${me.status}`, body: bodySnippet });
      }
    } catch(err) {
      console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}${String(user.ativo).padEnd(8)}✅       ERR   ❌ ${err.message}`);
      results.meErr++;
      errors.push({ email: user.email, issue: err.message });
    }
    
    await sleep(200);
  }
  
  console.log('\n' + '='.padEnd(100, '='));
  console.log('RESUMO FINAL COMPLETO');
  console.log('='.padEnd(100, '='));
  console.log(`✅ Senha OK + /api/me 200:   ${results.ok}`);
  console.log(`🚫 Bloqueados:               ${results.blocked}`);
  console.log(`❌ Bcrypt falhou:             ${results.bcryptFail}`);
  console.log(`⚠️  /api/me falhou:            ${results.meErr}`);
  console.log('-'.padEnd(100, '-'));
  console.log(`TOTAL: ${users.length} | OK: ${results.ok} | Bloq: ${results.blocked} | bcrypt fail: ${results.bcryptFail} | /me err: ${results.meErr}`);
  
  if (errors.length > 0) {
    console.log('\n❌ ERROS DETALHADOS:');
    errors.forEach(e => console.log(`   ${e.email}: ${e.issue}${e.body ? ' → ' + e.body : ''}`));
  }
  
  console.log('='.padEnd(100, '='));
  
  await conn.end();
}

main().catch(err => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
