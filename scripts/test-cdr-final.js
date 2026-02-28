const http = require('http');

// Step 1: Login
const loginData = JSON.stringify({ email: 'ti@aluforce.ind.br', password: 'Aluforce@2026' });

const loginReq = http.request({
    hostname: 'localhost', port: 3000, path: '/api/login',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) }
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (!json.token) { console.log('LOGIN FAIL:', data.substring(0, 200)); process.exit(1); }
            console.log('LOGIN OK - token length:', json.token.length);
            
            // Step 2: Test CDR status
            testEndpoint(json.token, '/api/vendas/ligacoes/status', 'STATUS');
            
            // Step 3: Test CDR dispositivos  
            testEndpoint(json.token, '/api/vendas/ligacoes/dispositivos', 'DISPOSITIVOS');
            
            // Step 4: Test CDR resumo
            testEndpoint(json.token, '/api/vendas/ligacoes/resumo?data_inicio=2026-02-23&data_fim=2026-02-23', 'RESUMO');
            
            // Step 5: Test CDR data
            testEndpoint(json.token, '/api/vendas/ligacoes/cdr?data_inicio=2026-02-23&data_fim=2026-02-23', 'CDR');
        } catch(e) { console.log('PARSE ERROR:', e.message, data.substring(0, 200)); }
    });
});
loginReq.write(loginData);
loginReq.end();

function testEndpoint(token, path, label) {
    const req = http.request({
        hostname: 'localhost', port: 3000, path,
        method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('\n[' + label + '] Status: ' + res.statusCode);
            try {
                const json = JSON.parse(data);
                if (label === 'STATUS') console.log(JSON.stringify(json, null, 2));
                else if (label === 'DISPOSITIVOS') console.log('Ramais:', json.length, json.map(function(r) { return r.name; }).join(', '));
                else if (label === 'RESUMO') console.log('Total:', json.total, 'Realizadas:', json.realizadas, 'Erro:', json.erro || 'nenhum');
                else if (label === 'CDR') console.log('Total:', json.total, 'Chamadas:', (json.chamadas || []).length);
            } catch(e) { console.log(data.substring(0, 300)); }
        });
    });
    req.end();
}
