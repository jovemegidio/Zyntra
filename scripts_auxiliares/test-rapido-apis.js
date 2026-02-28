/**
 * Teste rápido das APIs - executa imediatamente
 */
const http = require('http');

function req(path) {
    return new Promise((resolve) => {
        const options = { hostname: 'localhost', port: 3000, path, method: 'GET', timeout: 5000 };
        const r = http.request(options, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode < 500 }));
        });
        r.on('error', () => resolve({ status: 0, ok: false }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, ok: false }); });
        r.end();
    });
}

async function main() {
    const endpoints = [
        '/api/health',
        '/api/pcp/materiais',
        '/api/pcp/estatisticas',
        '/api/clientes',
        '/api/pedidos',
        '/api/financeiro/resumo',
        '/api/compras/fornecedores',
        '/api/nfe',
        '/api/logistica/transportadoras',
        '/api/notificacoes'
    ];
    
    console.log('\n🧪 TESTE RÁPIDO DE APIs\n');
    let ok = 0;
    for (const ep of endpoints) {
        const r = await req(ep);
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon} ${ep.padEnd(35)} -> ${r.status || 'ERRO'}`);
        if (r.ok) ok++;
    }
    console.log(`\n📊 Resultado: ${ok}/${endpoints.length} endpoints OK\n`);
}

main();
