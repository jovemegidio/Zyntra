const jwt = require('jsonwebtoken');
const http = require('http');

const secret = 'e1c084f3afad7116058bba8444655d9b328145b8ae72385da0499bf8b71c3324';
const token = jwt.sign({id: 1, nome: 'admin', role: 'admin'}, secret, {algorithm: 'HS256', expiresIn: '1h'});

console.log('Token:', token);

// Test status endpoint
http.get(`http://localhost:3000/api/vendas/ligacoes/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('\n=== /ligacoes/status ===');
        console.log('HTTP', res.statusCode);
        console.log(data);
    });
});
