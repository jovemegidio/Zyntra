// Test completo: Login + /api/me (direto e via Nginx)
const http = require('http');
const https = require('https');

const TEST_EMAIL = ['ti', 'aluforce.ind.br'].join('@');
const TEST_PASS = 'alu0103';

function testLogin() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS });
        const opts = {
            hostname: '127.0.0.1',
            port: 3000,
            path: '/api/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = http.request(opts, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                console.log('=== LOGIN ===');
                console.log('Status:', res.statusCode);
                const cookies = res.headers['set-cookie'] || [];
                console.log('Cookies recebidos:', cookies.length);
                cookies.forEach((c, i) => console.log(`  Cookie ${i}:`, c.split(';')[0].substring(0, 80)));
                
                try {
                    const j = JSON.parse(body);
                    console.log('Success:', j.success);
                    console.log('Has token:', !!j.token);
                    console.log('Token (40 chars):', j.token ? j.token.substring(0, 40) + '...' : 'NONE');
                    console.log('User:', j.user ? j.user.email : 'NONE');
                    console.log('RedirectTo:', j.redirectTo);
                    resolve({ token: j.token, cookies: cookies });
                } catch (e) {
                    console.log('Body (raw):', body.substring(0, 300));
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function testMe(token, cookies, label, useNginx) {
    return new Promise((resolve, reject) => {
        const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
        const headers = {};
        
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (cookieStr) headers['Cookie'] = cookieStr;
        
        const opts = useNginx ? {
            hostname: '127.0.0.1',
            port: 443,
            path: '/api/me',
            method: 'GET',
            headers: { ...headers, 'Host': 'aluforce.api.br' },
            rejectUnauthorized: false
        } : {
            hostname: '127.0.0.1',
            port: 3000,
            path: '/api/me',
            method: 'GET',
            headers: headers
        };
        
        const transport = useNginx ? https : http;
        const req = transport.request(opts, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                console.log(`\n=== ${label} ===`);
                console.log('Status:', res.statusCode);
                console.log('Headers sent:', JSON.stringify(headers).substring(0, 200));
                try {
                    const j = JSON.parse(body);
                    if (res.statusCode === 200) {
                        console.log('User:', j.email || j.nome || 'OK');
                    } else {
                        console.log('Error:', JSON.stringify(j));
                    }
                } catch (e) {
                    console.log('Body:', body.substring(0, 300));
                }
                resolve(res.statusCode);
            });
        });
        req.on('error', (e) => {
            console.log(`\n=== ${label} ERROR ===`);
            console.log(e.message);
            resolve(0);
        });
        req.end();
    });
}

async function main() {
    console.log('===========================================');
    console.log('TEST LOGIN FLOW - ' + new Date().toISOString());
    console.log('===========================================\n');
    
    try {
        // 1. Login
        const { token, cookies } = await testLogin();
        
        if (!token) {
            console.log('\n❌ FALHA: Login não retornou token!');
            return;
        }
        
        // 2. Test /api/me direto (bypass Nginx) com Bearer
        await testMe(token, cookies, '/api/me DIRETO (Bearer + Cookie)', false);
        
        // 3. Test /api/me direto só com Bearer (sem cookie)
        await testMe(token, [], '/api/me DIRETO (só Bearer)', false);
        
        // 4. Test /api/me direto só com Cookie (sem Bearer)
        await testMe(null, cookies, '/api/me DIRETO (só Cookie)', false);
        
        // 5. Test /api/me via Nginx com Bearer + Cookie
        await testMe(token, cookies, '/api/me VIA NGINX (Bearer + Cookie)', true);
        
        // 6. Test /api/me via Nginx só com Bearer
        await testMe(token, [], '/api/me VIA NGINX (só Bearer)', true);
        
        console.log('\n===========================================');
        console.log('TESTE CONCLUÍDO');
        console.log('===========================================');
        
    } catch (error) {
        console.error('ERRO:', error.message);
    }
}

main();
