// Testa apenas os usuarios que deram 429 no teste anterior
const http = require('http');

const REMAINING_USERS = [
  { id: 25, email: 'paula.souza@aluforce.ind.br' },
  { id: 26, email: 'ramon.lima@aluforce.ind.br' },
  { id: 27, email: 'regina.ballotti@aluforce.ind.br' },
  { id: 28, email: 'robson.goncalves@aluforce.ind.br' },
  { id: 29, email: 'ronaldo.santana@aluforce.ind.br' },
  { id: 30, email: 'thaina.freitas@aluforce.ind.br' },
  { id: 31, email: 'thiago.scarcella@aluforce.ind.br' },
  { id: 32, email: 'vera.souza@aluforce.ind.br' },
  { id: 33, email: 'willian.silva@aluforce.ind.br' },
  { id: 34, email: 'fernando.kofugi@aluforce.ind.br' },
  { id: 35, email: 'mauricio.torrolho@lumiereassessoria.com.br' },
  { id: 36, email: 'diego.lucena@lumiereassessoria.com.br' },
  { id: 37, email: 'jamerson.ribeiro@lumiereassessoria.com.br' },
  { id: 38, email: 'renata.nascimento@aluforce.ind.br' },
  { id: 39, email: 'kissia@aluforce.ind.br' },
  { id: 40, email: 'sarah@aluforce.ind.br' },
  { id: 42, email: 'cristian@aluforce.ind.br' },
  { id: 43, email: 'leo@aluforce.ind.br' },
  { id: 44, email: 'cleiton@aluforce.ind.br' },
  { id: 45, email: 'sergio@aluforce.ind.br' },
  { id: 46, email: 'luizhenrique@aluforce.ind.br' },
  { id: 51, email: 'silvio.nascimento@aluforce.ind.br' },
  { id: 52, email: 'lucio.silva@aluforce.ind.br' },
  { id: 53, email: 'joao.jesus@aluforce.ind.br' },
  { id: 54, email: 'ronaldo.silva@aluforce.ind.br' },
];

const PASSWORD = 'alu0103';
const BASE = 'http://localhost:3000';

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${path}`, {
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
  const results = { ok: 0, blocked: 0, meErr: 0, fail: 0, rateLimit: 0 };
  const blocked = [];
  const meErrors = [];
  const failures = [];

  console.log('='.join('').padEnd(80, '='));
  console.log(`TESTE USUARIOS RESTANTES - ${new Date().toISOString()}`);
  console.log(`Total: ${REMAINING_USERS.length} | Senha: ${PASSWORD} | Delay: 1500ms`);
  console.log('-'.padEnd(80, '-'));
  console.log('ID   EMAIL'.padEnd(50) + 'LOGIN   /me   RESULTADO');
  console.log('-'.padEnd(80, '-'));

  for (const user of REMAINING_USERS) {
    await sleep(1500); // delay maior para evitar rate limit

    try {
      const login = await httpPost('/api/login', { email: user.email, password: PASSWORD });

      if (login.status === 429) {
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}429     -     ⏳ RATE LIMITED`);
        results.rateLimit++;
        continue;
      }

      if (login.status === 403) {
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}403     -     🚫 BLOQUEADO`);
        results.blocked++;
        blocked.push(user.email);
        continue;
      }

      if (login.status !== 200) {
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}${login.status}     -     ❌ FALHOU`);
        results.fail++;
        failures.push({ email: user.email, loginStatus: login.status });
        continue;
      }

      const data = JSON.parse(login.body);
      const token = data.token;

      await sleep(300);
      const me = await httpGet('/api/me', token);

      if (me.status === 200) {
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}200     200   ✅ OK`);
        results.ok++;
      } else {
        console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}200     ${me.status}   ⚠️ /me FALHOU`);
        results.meErr++;
        meErrors.push({ email: user.email, meStatus: me.status, body: me.body.substring(0, 100) });
      }
    } catch (err) {
      console.log(`${String(user.id).padEnd(5)}${user.email.padEnd(46)}ERR     -     ❌ ${err.message}`);
      results.fail++;
    }
  }

  console.log('\n' + '='.padEnd(80, '='));
  console.log('RESUMO USUARIOS RESTANTES');
  console.log('='.padEnd(80, '='));
  console.log(`✅ Login + /api/me OK:        ${results.ok}`);
  console.log(`🚫 Bloqueados (demitidos):    ${results.blocked}`);
  if (blocked.length > 0) blocked.forEach(e => console.log(`    ${e}`));
  console.log(`⚠️  Login OK, /api/me falhou:  ${results.meErr}`);
  if (meErrors.length > 0) meErrors.forEach(e => console.log(`    ${e.email} → ${e.meStatus}: ${e.body}`));
  console.log(`❌ Senha/email incorreto:     ${results.fail}`);
  if (failures.length > 0) failures.forEach(e => console.log(`    ${e.email} → ${e.loginStatus}`));
  console.log(`⏳ Rate limited (429):        ${results.rateLimit}`);
  console.log('-'.padEnd(80, '-'));
  console.log(`TOTAL: ${REMAINING_USERS.length} | OK: ${results.ok} | Bloq: ${results.blocked} | /me err: ${results.meErr} | Fail: ${results.fail} | 429: ${results.rateLimit}`);

  // Resultado combinado com os 18+5 que ja passaram
  console.log('\n' + '='.padEnd(80, '='));
  console.log('RESULTADO GLOBAL (COMBINADO COM TESTE ANTERIOR)');
  console.log('='.padEnd(80, '='));
  console.log(`✅ Total OK:       ${18 + results.ok} (18 anteriores + ${results.ok} agora)`);
  console.log(`🚫 Total Bloq:     ${5 + results.blocked} (5 anteriores + ${results.blocked} agora)`);
  console.log(`⚠️  Total /me err:  ${results.meErr}`);
  console.log(`❌ Total fail:     ${results.fail}`);
  console.log(`⏳ Ainda 429:      ${results.rateLimit}`);
  console.log('='.padEnd(80, '='));
}

main().catch(console.error);
