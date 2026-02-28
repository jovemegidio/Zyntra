const http = require('http');

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

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

async function testUser(email) {
  console.log(`\n--- Testando: ${email} ---`);
  
  // 1. Login
  const login = await httpPost('/api/login', { email, password: 'alu0103' });
  console.log(`Login: ${login.status}`);
  
  if (login.status !== 200) {
    console.log(`❌ Login falhou: ${login.body.substring(0, 100)}`);
    return;
  }
  
  const data = JSON.parse(login.body);
  const token = data.token;
  
  // 2. /api/me
  const me = await httpGet('/api/me', token);
  console.log(`/api/me: ${me.status}`);
  
  if (me.status === 200) {
    const meData = JSON.parse(me.body);
    console.log(`✅ Nome: ${meData.nome}`);
    console.log(`✅ Areas: ${JSON.stringify(meData.areas)}`);
    console.log(`✅ Role: ${meData.role}`);
    console.log(`✅ Departamento: ${meData.departamento || meData.setor}`);
  } else {
    console.log(`❌ /api/me falhou: ${me.body.substring(0, 150)}`);
  }
  
  // 3. Testar acesso financeiro
  const fin = await httpGet('/api/financeiro/resumo', token);
  console.log(`/api/financeiro: ${fin.status} ${fin.status === 200 ? '✅' : fin.status === 404 ? '⚠️ rota não existe' : '❌ BLOQUEADO'}`);
  
  // 4. Testar que NÃO tem acesso a vendas
  const vendas = await httpGet('/api/vendas/pedidos', token);
  console.log(`/api/vendas: ${vendas.status} ${vendas.status === 403 ? '✅ CORRETAMENTE BLOQUEADO' : vendas.status === 200 ? '⚠️ TEM ACESSO (não deveria)' : `(${vendas.status})`}`);
  
  // 5. Testar que NÃO tem acesso a PCP
  const pcp = await httpGet('/api/pcp/dashboard', token);
  console.log(`/api/pcp: ${pcp.status} ${pcp.status === 403 ? '✅ CORRETAMENTE BLOQUEADO' : pcp.status === 200 ? '⚠️ TEM ACESSO (não deveria)' : `(${pcp.status})`}`);
}

async function main() {
  console.log('='.padEnd(60, '='));
  console.log('TESTE DE PERMISSÕES - HELLEN E TATIANE');
  console.log('='.padEnd(60, '='));
  
  await testUser('hellen.nascimento@aluforce.ind.br');
  await testUser('tatiane.sousa@aluforce.ind.br');
  
  console.log('\n' + '='.padEnd(60, '='));
  console.log('TESTE CONCLUÍDO');
  console.log('='.padEnd(60, '='));
}

main().catch(console.error);
