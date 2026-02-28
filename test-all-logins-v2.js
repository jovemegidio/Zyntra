// Teste de login para TODOS os usuarios - v2 com delays para evitar rate limit
require('dotenv').config();
const http = require('http');
const mysql = require('mysql2/promise');

const TEST_PASS = 'alu0103';
const results = { ok: [], fail: [], blocked: [], meErr: [], rateLimit: [] };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpPost(path, body) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body);
        const opts = {
            hostname: '127.0.0.1', port: 3000, path, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };
        const req = http.request(opts, (res) => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
                catch (e) { resolve({ status: res.statusCode, body: { message: b.substring(0, 100) } }); }
            });
        });
        req.on('error', (e) => resolve({ status: 0, body: { message: e.message } }));
        req.write(data);
        req.end();
    });
}

function httpGet(path, headers) {
    return new Promise((resolve) => {
        const opts = { hostname: '127.0.0.1', port: 3000, path, method: 'GET', headers };
        const req = http.request(opts, (res) => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', () => resolve(0));
        req.end();
    });
}

function pad(str, len) { return (str + ' '.repeat(len)).substring(0, len); }

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    const [users] = await pool.query('SELECT id, email, nome FROM usuarios ORDER BY id');
    
    console.log('='.repeat(100));
    console.log('TESTE DE LOGIN - TODOS OS USUARIOS - ' + new Date().toISOString());
    console.log('='.repeat(100));
    console.log('Total usuarios:', users.length, '| Senha:', TEST_PASS, '| Delay: 500ms entre requests');
    console.log('-'.repeat(100));
    console.log(pad('ID',4), pad('EMAIL',45), pad('LOGIN',7), pad('/me',5), 'RESULTADO');
    console.log('-'.repeat(100));

    for (const user of users) {
        // Login
        const login = await httpPost('/api/login', { email: user.email, password: TEST_PASS });
        
        let meCode = '-';
        let label = '';

        if (login.status === 200 && login.body.token) {
            // Test /api/me with the token
            meCode = await httpGet('/api/me', { 'Authorization': 'Bearer ' + login.body.token });
            
            if (meCode === 200) {
                label = '✅ OK';
                results.ok.push(user.email);
            } else {
                label = '⚠️ Login OK mas /api/me=' + meCode;
                results.meErr.push({ email: user.email, meCode });
            }
        } else if (login.status === 403) {
            label = '🚫 BLOQUEADO';
            results.blocked.push(user.email);
        } else if (login.status === 401) {
            label = '❌ Senha/email incorreto';
            results.fail.push(user.email);
        } else if (login.status === 429) {
            label = '⏳ RATE LIMITED';
            results.rateLimit.push(user.email);
        } else {
            label = '❓ HTTP ' + login.status + ': ' + (login.body.message || '').substring(0, 40);
            results.fail.push(user.email);
        }

        console.log(pad(String(user.id),4), pad(user.email,45), pad(String(login.status),7), pad(String(meCode),5), label);
        
        // Delay between requests to avoid rate limiting
        await sleep(500);
    }

    console.log('\n' + '='.repeat(100));
    console.log('RESUMO FINAL');
    console.log('='.repeat(100));
    console.log('✅ Login + /api/me OK:       ', results.ok.length);
    console.log('🚫 Bloqueados (demitidos):   ', results.blocked.length);
    if (results.blocked.length) results.blocked.forEach(e => console.log('   ', e));
    console.log('⚠️  Login OK, /api/me falhou: ', results.meErr.length);
    if (results.meErr.length) results.meErr.forEach(e => console.log('   ', e.email, '-> /api/me', e.meCode));
    console.log('❌ Senha/email incorreto:    ', results.fail.length);
    if (results.fail.length) results.fail.forEach(e => console.log('   ', e));
    console.log('⏳ Rate limited (429):       ', results.rateLimit.length);
    console.log('-'.repeat(100));
    console.log('TOTAL:', users.length, '| OK:', results.ok.length, '| Bloq:', results.blocked.length,
        '| /me err:', results.meErr.length, '| Fail:', results.fail.length, '| 429:', results.rateLimit.length);
    console.log('='.repeat(100));

    await pool.end();
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
