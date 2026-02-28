// Diagnostic script - test the full login → /api/me flow
const http = require('http');
const https = require('https');

const loginData = JSON.stringify({ 
    email: 'ti@aluforce.ind.br', 
    password: 'Aluforce@2026' 
});

console.log('=== STEP 1: Testing LOGIN ===');

const loginReq = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
    }
}, loginRes => {
    let body = '';
    const cookies = loginRes.headers['set-cookie'] || [];
    
    loginRes.on('data', c => body += c);
    loginRes.on('end', () => {
        console.log('Login Status:', loginRes.statusCode);
        console.log('Set-Cookie present:', cookies.length > 0);
        
        let data;
        try { data = JSON.parse(body); } catch(e) { 
            console.log('Login raw body:', body.substring(0, 300));
            console.log('FATAL: Could not parse login response');
            return; 
        }
        
        if (loginRes.statusCode !== 200) {
            console.log('Login FAILED:', data.message);
            console.log('\nTrying alternative passwords...');
            tryAlternativeLogin();
            return;
        }
        
        console.log('Login SUCCESS');
        console.log('Token present:', !!data.token);
        console.log('Token length:', data.token ? data.token.length : 0);
        console.log('User:', data.user ? data.user.email : 'N/A');
        
        if (data.token) {
            testApiMe(data.token, cookies);
        }
    });
});

loginReq.on('error', e => console.error('Login Error:', e.message));
loginReq.write(loginData);
loginReq.end();

function tryAlternativeLogin() {
    // Try with a simpler password
    const data2 = JSON.stringify({ email: 'ti@aluforce.ind.br', password: '123456' });
    
    const req2 = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data2)
        }
    }, res2 => {
        let body = '';
        res2.on('data', c => body += c);
        res2.on('end', () => {
            console.log('\nAlternative login status:', res2.statusCode);
            try {
                const d = JSON.parse(body);
                console.log('Message:', d.message || 'success');
                if (d.token) {
                    console.log('Got token! Testing /api/me...');
                    testApiMe(d.token, res2.headers['set-cookie'] || []);
                }
            } catch(e) {
                console.log('Body:', body.substring(0, 200));
            }
        });
    });
    req2.write(data2);
    req2.end();
}

function testApiMe(token, cookies) {
    console.log('\n=== STEP 2: Testing /api/me WITH Bearer token ===');
    
    // Extract cookie value
    let cookieHeader = '';
    if (cookies.length > 0) {
        cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
    }
    
    const meReq = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/me',
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Cookie': cookieHeader || ('authToken=' + token)
        }
    }, meRes => {
        let body = '';
        meRes.on('data', c => body += c);
        meRes.on('end', () => {
            console.log('/api/me Status:', meRes.statusCode);
            try {
                const d = JSON.parse(body);
                if (meRes.statusCode === 200) {
                    console.log('/api/me User:', d.email || d.nome || JSON.stringify(d).substring(0, 100));
                    console.log('SUCCESS! Token is valid.');
                } else {
                    console.log('/api/me Error:', d.message);
                    console.log('FAIL! Token rejected.');
                }
            } catch(e) {
                console.log('/api/me Body:', body.substring(0, 200));
            }
            
            // Test 3: Without Bearer, only cookie
            console.log('\n=== STEP 3: Testing /api/me with COOKIE ONLY ===');
            const meReq2 = http.request({
                hostname: 'localhost',
                port: 3000,
                path: '/api/me',
                method: 'GET',
                headers: {
                    'Cookie': cookieHeader || ('authToken=' + token)
                }
            }, meRes2 => {
                let body2 = '';
                meRes2.on('data', c => body2 += c);
                meRes2.on('end', () => {
                    console.log('/api/me (cookie only) Status:', meRes2.statusCode);
                    try {
                        const d = JSON.parse(body2);
                        console.log('/api/me (cookie only):', d.message || d.email || 'OK');
                    } catch(e) {}
                    
                    // Test 4: No auth at all
                    console.log('\n=== STEP 4: Testing /api/me with NO AUTH ===');
                    const meReq3 = http.request({
                        hostname: 'localhost',
                        port: 3000,
                        path: '/api/me',
                        method: 'GET',
                        headers: {}
                    }, meRes3 => {
                        let body3 = '';
                        meRes3.on('data', c => body3 += c);
                        meRes3.on('end', () => {
                            console.log('/api/me (no auth) Status:', meRes3.statusCode);
                            console.log('\n=== DIAGNOSIS COMPLETE ===');
                            if (meRes.statusCode === 200) {
                                console.log('RESULT: Token auth works. Problem is client-side.');
                            } else {
                                console.log('RESULT: Token rejected server-side. Check JWT_SECRET consistency.');
                            }
                        });
                    });
                    meReq3.end();
                });
            });
            meReq2.end();
        });
    });
    meReq.end();
}
