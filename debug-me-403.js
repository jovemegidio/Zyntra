// Debug detalhado: por que /api/me retorna 403 para alguns usuarios?
require('dotenv').config();
const http = require('http');

const TEST_PASS = 'alu0103';

// Usuarios que falharam: augusto, bruno, christian, clayton, junior, fabiano, fabiola, hellen, marcia, marcos
// Usuarios que passaram: ana, andreia, ti, clemerson, douglas, guilherme, rh(isabela), leonardo(lucas)
const testUsers = [
    'ti@aluforce.ind.br',       // OK - admin
    'augusto.ladeira@aluforce.ind.br',  // FAIL
    'douglas@aluforce.ind.br',  // OK - admin
    'bruno.freitas@aluforce.ind.br',    // FAIL
];

function httpReq(method, path, headers, body) {
    return new Promise((resolve) => {
        const opts = {
            hostname: '127.0.0.1', port: 3000, path, method,
            headers: headers || {}
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request(opts, (res) => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(b), headers: res.headers }); }
                catch (e) { resolve({ status: res.statusCode, body: { raw: b.substring(0, 500) }, headers: res.headers }); }
            });
        });
        req.on('error', (e) => resolve({ status: 0, body: { error: e.message }, headers: {} }));
        if (body) req.write(body);
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    console.log('=== DEBUG /api/me 403 ===\n');

    for (const email of testUsers) {
        console.log('--- Testing:', email, '---');
        
        // 1. Login
        const login = await httpReq('POST', '/api/login', {}, JSON.stringify({ email, password: TEST_PASS }));
        console.log('  Login:', login.status);
        
        if (login.status !== 200 || !login.body.token) {
            console.log('  Login failed:', login.body.message);
            await sleep(500);
            continue;
        }
        
        const token = login.body.token;
        
        // Decode JWT payload (without verification) 
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log('  JWT payload:', JSON.stringify({
            id: payload.id, nome: payload.nome, email: payload.email, 
            role: payload.role, setor: payload.setor, deviceId: payload.deviceId ? payload.deviceId.substring(0,8) : null,
            iat: payload.iat, exp: payload.exp, aud: payload.aud
        }));
        
        // 2. GET /api/me with Bearer
        const me = await httpReq('GET', '/api/me', { 'Authorization': 'Bearer ' + token });
        console.log('  /api/me:', me.status);
        if (me.status !== 200) {
            console.log('  /api/me response:', JSON.stringify(me.body));
            console.log('  /api/me response headers:', JSON.stringify({
                'content-type': me.headers['content-type'],
                'x-powered-by': me.headers['x-powered-by']
            }));
        } else {
            console.log('  /api/me user:', me.body.email, '| role:', me.body.role);
        }
        
        // 3. Also test with Cookie only
        const cookies = login.headers['set-cookie'] || [];
        const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
        const meC = await httpReq('GET', '/api/me', { 'Cookie': cookieStr });
        console.log('  /api/me (cookie):', meC.status, meC.status !== 200 ? JSON.stringify(meC.body) : '');
        
        console.log('');
        await sleep(1000); // More delay to avoid rate limit
    }
})().catch(e => console.error('FATAL:', e.message));
