const jwt = require('jsonwebtoken');
const http = require('http');
const mysql = require('mysql2/promise');

async function test() {
    // Test 1: Direct MySQL queries
    const pool = mysql.createPool({
        host: 'localhost',
        user: 'aluforce',
        password: 'Aluforce2026VpsDB',
        database: 'aluforce_vendas'
    });

    try {
        console.log('=== Test 1: Autocomplete query (direct MySQL) ===');
        const [rows] = await pool.query(`SELECT id,
            COALESCE(razao_social, nome) as razao_social,
            COALESCE(nome_fantasia, nome) as nome,
            COALESCE(cnpj_cpf, cnpj, cpf, '') as cnpj_cpf,
            COALESCE(cidade, '') as cidade,
            COALESCE(estado, '') as uf,
            telefone, email
            FROM clientes WHERE (ativo = 1 OR ativo IS NULL)
            ORDER BY COALESCE(razao_social, nome) LIMIT 5`);
        console.log('SUCCESS:', rows.length, 'rows');
    } catch(e) {
        console.log('ERROR:', e.code, e.message);
    }
    await pool.end();

    // Test 2: HTTP endpoint with auth
    console.log('\n=== Test 2: HTTP /api/clientes (no gestao param) ===');
    const secret = require('dotenv').config().parsed?.JWT_SECRET || 'e1c084f3afad7116058bba8444655d9b328145b8ae72385da0499bf8b71c3324';
    const token = jwt.sign({id: 3, email: 'admin@aluforce.com', role: 'admin', is_admin: true}, secret, {expiresIn: '1h'});

    await new Promise((resolve) => {
        const req = http.get('http://localhost:3000/api/clientes', {
            headers: { 'Authorization': 'Bearer ' + token, 'Cookie': 'token=' + token }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('STATUS:', res.statusCode);
                console.log('BODY:', data.substring(0, 500));
                resolve();
            });
        });
        req.on('error', e => { console.log('ERROR:', e.message); resolve(); });
    });
}
test();
