// Teste de login para TODOS os usuários
require('dotenv').config();
const http = require('http');
const mysql = require('mysql2/promise');

const TEST_PASS = 'alu0103';
const results = { ok: [], fail: [], blocked: [], error: [] };

function loginTest(email) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ email, password: TEST_PASS });
        const opts = {
            hostname: '127.0.0.1', port: 3000, path: '/api/login', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };
        const req = http.request(opts, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const j = JSON.parse(body);
                    resolve({ email, status: res.statusCode, token: !!j.token, message: j.message || '', redirectTo: j.redirectTo || '' });
                } catch (e) {
                    resolve({ email, status: res.statusCode, token: false, message: 'JSON parse error', redirectTo: '' });
                }
            });
        });
        req.on('error', (e) => resolve({ email, status: 0, token: false, message: e.message, redirectTo: '' }));
        req.write(data);
        req.end();
    });
}

function testMe(token) {
    return new Promise((resolve) => {
        const opts = {
            hostname: '127.0.0.1', port: 3000, path: '/api/me', method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        };
        const req = http.request(opts, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', () => resolve(0));
        req.end();
    });
}

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    const [users] = await pool.query('SELECT id, email, nome FROM usuarios ORDER BY id');
    console.log('='.repeat(90));
    console.log('TESTE DE LOGIN - TODOS OS USUARIOS - ' + new Date().toISOString());
    console.log('='.repeat(90));
    console.log('Total usuarios no banco:', users.length);
    console.log('Senha de teste: ' + TEST_PASS);
    console.log('-'.repeat(90));
    console.log(pad('ID',4), pad('EMAIL',42), pad('STATUS',8), pad('/api/me',8), 'RESULTADO');
    console.log('-'.repeat(90));

    for (const user of users) {
        const r = await loginTest(user.email);
        let meStatus = '-';
        let label = '';

        if (r.status === 200 && r.token) {
            // Login OK - test /api/me
            const body = await new Promise((resolve) => {
                const data = JSON.stringify({ email: user.email, password: TEST_PASS });
                const opts = {
                    hostname: '127.0.0.1', port: 3000, path: '/api/login', method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                };
                const req = http.request(opts, (res) => {
                    let b = '';
                    res.on('data', d => b += d);
                    res.on('end', () => resolve(JSON.parse(b)));
                });
                req.write(data);
                req.end();
            });
            meStatus = await testMe(body.token);
            if (meStatus === 200) {
                label = '✅ OK';
                results.ok.push(user.email);
            } else {
                label = '⚠️ Login OK, /api/me ' + meStatus;
                results.error.push({ email: user.email, detail: '/api/me returned ' + meStatus });
            }
        } else if (r.status === 403) {
            label = '🚫 BLOQUEADO: ' + r.message.substring(0, 40);
            results.blocked.push({ email: user.email, msg: r.message });
            meStatus = '-';
        } else if (r.status === 401) {
            label = '❌ FALHOU: ' + r.message.substring(0, 40);
            results.fail.push({ email: user.email, msg: r.message });
            meStatus = '-';
        } else {
            label = '❓ STATUS ' + r.status + ': ' + r.message.substring(0, 30);
            results.error.push({ email: user.email, detail: 'Status ' + r.status });
            meStatus = '-';
        }

        console.log(pad(String(user.id),4), pad(user.email,42), pad(String(r.status),8), pad(String(meStatus),8), label);
    }

    console.log('\n' + '='.repeat(90));
    console.log('RESUMO');
    console.log('='.repeat(90));
    console.log('✅ Login + /api/me OK:', results.ok.length);
    console.log('🚫 Bloqueados (demitido/inativo):', results.blocked.length);
    if (results.blocked.length > 0) {
        results.blocked.forEach(b => console.log('   -', b.email, '|', b.msg.substring(0, 60)));
    }
    console.log('❌ Falhou (senha/email):', results.fail.length);
    if (results.fail.length > 0) {
        results.fail.forEach(f => console.log('   -', f.email, '|', f.msg));
    }
    console.log('⚠️ Erros:', results.error.length);
    if (results.error.length > 0) {
        results.error.forEach(e => console.log('   -', e.email, '|', e.detail));
    }
    console.log('\nTotal testados:', users.length);
    console.log('='.repeat(90));

    await pool.end();
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

function pad(str, len) { return (str + ' '.repeat(len)).substring(0, len); }
