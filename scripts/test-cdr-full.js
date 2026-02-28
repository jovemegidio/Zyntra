const jwt = require('jsonwebtoken');
const http = require('http');

const secret = 'e1c084f3afad7116058bba8444655d9b328145b8ae72385da0499bf8b71c3324';
const token = jwt.sign({id: 1, nome: 'admin', role: 'admin'}, secret, {algorithm: 'HS256', expiresIn: '1h'});

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3000${path}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
    });
}

async function main() {
    // Test 1: Status
    console.log('\n=== Test 1: /api/vendas/ligacoes/status ===');
    const status = await makeRequest('/api/vendas/ligacoes/status');
    console.log('HTTP', status.status);
    console.log(status.data);
    
    // Test 2: CDR data (today)
    console.log('\n=== Test 2: /api/vendas/ligacoes/cdr ===');
    console.log('(This will take ~30 seconds - Puppeteer needs to login and scrape)');
    const today = new Date().toISOString().split('T')[0];
    const cdr = await makeRequest(`/api/vendas/ligacoes/cdr?data_inicio=${today}&data_fim=${today}`);
    console.log('HTTP', cdr.status);
    const cdrData = JSON.parse(cdr.data);
    console.log('Total chamadas:', cdrData.total || 0);
    if (cdrData.chamadas && cdrData.chamadas.length > 0) {
        console.log('Primeira:', JSON.stringify(cdrData.chamadas[0]));
        console.log('Ultima:', JSON.stringify(cdrData.chamadas[cdrData.chamadas.length - 1]));
    } else if (cdrData.error) {
        console.log('Erro:', cdrData.error);
    }
    
    // Test 3: Resumo
    console.log('\n=== Test 3: /api/vendas/ligacoes/resumo ===');
    const resumo = await makeRequest(`/api/vendas/ligacoes/resumo?data_inicio=${today}&data_fim=${today}`);
    console.log('HTTP', resumo.status);
    console.log(resumo.data);
}

main().catch(err => console.error('Error:', err.message));
