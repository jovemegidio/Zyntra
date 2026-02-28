// Reset password for ti user and test CDR
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const http = require('http');

async function main() {
    // Generate hash
    const newPass = 'Test@CDR2026';
    const hash = await bcrypt.hash(newPass, 10);
    console.log('New hash generated');

    // Update in DB
    const pool = await mysql.createPool({
        host: 'localhost',
        user: 'aluforce',
        password: 'Aluforce2026VpsDB',
        database: 'aluforce_vendas'
    });

    await pool.query('UPDATE usuarios SET senha_hash = ?, password_hash = ? WHERE id = 3', [hash, hash]);
    console.log('Password updated for ti user');

    // Login
    const loginData = JSON.stringify({ email: 'ti@aluforce.ind.br', password: newPass });
    
    const token = await new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost', port: 3000, path: '/api/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.token) resolve(json.token);
                    else reject(new Error('No token: ' + data.substring(0, 200)));
                } catch(e) { reject(e); }
            });
        });
        req.write(loginData);
        req.end();
    });

    console.log('LOGIN OK, token length:', token.length);

    // Test all CDR endpoints
    const endpoints = [
        { path: '/api/vendas/ligacoes/status', label: 'STATUS' },
        { path: '/api/vendas/ligacoes/dispositivos', label: 'DISPOSITIVOS' },
        { path: '/api/vendas/ligacoes/resumo?data_inicio=2026-02-23&data_fim=2026-02-23', label: 'RESUMO' },
        { path: '/api/vendas/ligacoes/cdr?data_inicio=2026-02-23&data_fim=2026-02-23', label: 'CDR' }
    ];

    for (const ep of endpoints) {
        try {
            const result = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: 'localhost', port: 3000, path: ep.path,
                    method: 'GET',
                    headers: { 'Authorization': 'Bearer ' + token },
                    timeout: 90000
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        resolve({ status: res.statusCode, data });
                    });
                });
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                req.on('error', reject);
                req.end();
            });

            console.log('\n[' + ep.label + '] HTTP ' + result.status);
            try {
                const json = JSON.parse(result.data);
                if (ep.label === 'STATUS') {
                    console.log(JSON.stringify(json, null, 2));
                } else if (ep.label === 'DISPOSITIVOS') {
                    console.log('Ramais encontrados:', json.length);
                    json.forEach(function(r) { console.log('  -', r.name, '(' + r.id + ')'); });
                } else if (ep.label === 'RESUMO') {
                    console.log('Total:', json.total, '| Realizadas:', json.realizadas, '| Atendidas:', json.atendidas);
                    if (json.erro) console.log('ERRO:', json.erro);
                } else if (ep.label === 'CDR') {
                    console.log('Total:', json.total, '| Chamadas:', (json.chamadas || []).length);
                    if (json.chamadas && json.chamadas.length > 0) {
                        console.log('Primeira chamada:', JSON.stringify(json.chamadas[0]));
                    }
                    if (json.error) console.log('ERRO:', json.error);
                }
            } catch(e) {
                console.log('Response (raw):', result.data.substring(0, 300));
            }
        } catch (err) {
            console.log('\n[' + ep.label + '] ERROR:', err.message);
        }
    }

    await pool.end();
    console.log('\n--- DONE ---');
    process.exit(0);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
