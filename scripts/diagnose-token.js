// Quick test: generate a token and verify it
try { require('dotenv').config(); } catch(e) {
    // Load .env manually
    const fs = require('fs');
    const envPath = '/var/www/aluforce/.env';
    if (fs.existsSync(envPath)) {
        fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
            const [key, ...vals] = line.split('=');
            if (key && !key.startsWith('#')) process.env[key.trim()] = vals.join('=').trim();
        });
    }
}
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const JWT_SECRET = process.env.JWT_SECRET;
console.log('JWT_SECRET length:', JWT_SECRET ? JWT_SECRET.length : 'UNDEFINED');
console.log('NODE_ENV:', process.env.NODE_ENV);

(async () => {
    try {
        // Connect to DB
        const pool = await mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // Get a user
        const [users] = await pool.query(
            'SELECT id, email, nome, role, setor, senha_hash, senha FROM usuarios LIMIT 3'
        );

        console.log('\n=== USERS ===');
        for (const u of users) {
            console.log(`  ${u.id}: ${u.email} (${u.role}) hash_type: ${u.senha_hash ? (u.senha_hash.startsWith('$2') ? 'bcrypt' : 'plain') : (u.senha ? 'legacy_field' : 'none')}`);
        }

        if (users.length === 0) {
            console.log('No users found!');
            await pool.end();
            return;
        }

        const testUser = users[0];
        console.log('\n=== TESTING WITH USER:', testUser.email, '===');

        // Sign a token (same way as auth.js)
        const token = jwt.sign({
            id: testUser.id,
            nome: testUser.nome,
            email: testUser.email,
            role: testUser.role,
            setor: testUser.setor || null,
            deviceId: 'test-device-123'
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });

        console.log('Token generated, length:', token.length);
        console.log('Token preview:', token.substring(0, 50) + '...');

        // Verify token (same way as authenticateToken middleware)
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            console.log('\n✅ jwt.verify SUCCESS');
            console.log('  email:', decoded.email);
            console.log('  aud:', decoded.aud);
        } catch (e) {
            console.log('\n❌ jwt.verify FAILED:', e.message);
        }

        // Now test via HTTP
        const http = require('http');
        
        console.log('\n=== HTTP TEST: /api/me with Bearer token ===');
        
        await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3000,
                path: '/api/me',
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Cookie': 'authToken=' + token
                }
            }, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    console.log('Status:', res.statusCode);
                    try {
                        const d = JSON.parse(body);
                        if (res.statusCode === 200) {
                            console.log('✅ /api/me SUCCESS - User:', d.email);
                        } else {
                            console.log('❌ /api/me FAILED:', d.message);
                        }
                    } catch(e) {
                        console.log('Body:', body.substring(0, 200));
                    }
                    resolve();
                });
            });
            req.on('error', e => { console.log('HTTP Error:', e.message); resolve(); });
            req.end();
        });

        // Test with ONLY cookie
        console.log('\n=== HTTP TEST: /api/me with Cookie ONLY ===');
        await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3000,
                path: '/api/me',
                method: 'GET',
                headers: {
                    'Cookie': 'authToken=' + token
                }
            }, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    console.log('Status:', res.statusCode);
                    try {
                        const d = JSON.parse(body);
                        console.log(res.statusCode === 200 ? '✅ Cookie auth works' : '❌ Cookie auth failed: ' + d.message);
                    } catch(e) {}
                    resolve();
                });
            });
            req.on('error', e => { console.log('HTTP Error:', e.message); resolve(); });
            req.end();
        });

        // Test with NO auth
        console.log('\n=== HTTP TEST: /api/me with NO AUTH ===');
        await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3000,
                path: '/api/me',
                method: 'GET',
                headers: {}
            }, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    console.log('Status:', res.statusCode, '(expected 401)');
                    resolve();
                });
            });
            req.on('error', e => { console.log('HTTP Error:', e.message); resolve(); });
            req.end();
        });

        console.log('\n=== DIAGNOSIS COMPLETE ===');
        await pool.end();
    } catch (e) {
        console.error('FATAL:', e.message);
    }
})();
