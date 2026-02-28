// Script de teste de login na VPS
const http = require('http');

const data = JSON.stringify({ email: 'ti@aluforce.ind.br', password: '123456' });

const opts = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

const req = http.request(opts, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
        console.log('=== LOGIN RESPONSE ===');
        console.log('Status:', res.statusCode);
        
        // Extract cookie
        const cookies = res.headers['set-cookie'] || [];
        console.log('Set-Cookie:', cookies.length ? cookies[0].substring(0, 80) + '...' : 'NONE');
        
        let parsed;
        try { parsed = JSON.parse(body); } catch(e) { console.log('Raw body:', body); return; }
        
        console.log('Success:', parsed.success);
        console.log('Has token:', !!parsed.token);
        console.log('Token length:', parsed.token ? parsed.token.length : 0);
        console.log('User:', parsed.user ? parsed.user.email : 'N/A');
        console.log('RedirectTo:', parsed.redirectTo || 'N/A');
        
        if (!parsed.token) {
            console.log('ERROR: No token returned!');
            console.log('Full response:', JSON.stringify(parsed, null, 2));
            return;
        }
        
        // Now test /api/me with the token
        console.log('\n=== TESTING /api/me WITH TOKEN ===');
        const meOpts = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/me',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + parsed.token,
                'Cookie': 'authToken=' + parsed.token
            }
        };
        
        const meReq = http.request(meOpts, meRes => {
            let meBody = '';
            meRes.on('data', c => meBody += c);
            meRes.on('end', () => {
                console.log('/api/me Status:', meRes.statusCode);
                try {
                    const meData = JSON.parse(meBody);
                    console.log('/api/me User:', meData.email || meData.nome || 'N/A');
                    console.log('/api/me Success: TRUE');
                } catch(e) {
                    console.log('/api/me Body:', meBody.substring(0, 200));
                    console.log('/api/me Success: FALSE');
                }
            });
        });
        meReq.end();
        
        // Also test /api/me WITHOUT token (only cookie via credentials)
        console.log('\n=== TESTING /api/me WITHOUT Authorization HEADER (cookie only) ===');
        const meOpts2 = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/me',
            method: 'GET',
            headers: {
                'Cookie': 'authToken=' + parsed.token
            }
        };
        
        const meReq2 = http.request(meOpts2, meRes2 => {
            let meBody2 = '';
            meRes2.on('data', c => meBody2 += c);
            meRes2.on('end', () => {
                console.log('/api/me (cookie only) Status:', meRes2.statusCode);
                try {
                    const meData2 = JSON.parse(meBody2);
                    console.log('/api/me (cookie only) User:', meData2.email || meData2.nome || 'N/A');
                } catch(e) {
                    console.log('/api/me (cookie only) Body:', meBody2.substring(0, 200));
                }
            });
        });
        meReq2.end();

        // Also test /api/me with NO auth at all
        console.log('\n=== TESTING /api/me WITH NO AUTH ===');
        const meOpts3 = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/me',
            method: 'GET',
            headers: {}
        };
        
        const meReq3 = http.request(meOpts3, meRes3 => {
            let meBody3 = '';
            meRes3.on('data', c => meBody3 += c);
            meRes3.on('end', () => {
                console.log('/api/me (no auth) Status:', meRes3.statusCode);
            });
        });
        meReq3.end();
    });
});

req.on('error', e => console.error('Error:', e.message));
req.write(data);
req.end();
