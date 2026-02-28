/**
 * Teste completo das funcionalidades dos módulos ALUFORCE
 * Verifica APIs e endpoints críticos
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

// Função para fazer requisições HTTP
function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 10000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Testes organizados por módulo
const testes = {
    'Sistema': [
        { nome: 'Health Check', endpoint: '/api/health', esperado: 200 },
    ],
    'PCP': [
        { nome: 'Listar Materiais', endpoint: '/api/pcp/materiais', esperado: [200, 401] },
        { nome: 'Estatísticas Dashboard', endpoint: '/api/pcp/estatisticas', esperado: [200, 401] },
        { nome: 'Ordens de Produção', endpoint: '/api/pcp/ordens-producao', esperado: [200, 401] },
        { nome: 'Produtos Disponíveis', endpoint: '/api/pcp/estoque/produtos-disponiveis', esperado: [200, 401] },
    ],
    'Vendas': [
        { nome: 'Listar Clientes', endpoint: '/api/clientes', esperado: [200, 401] },
        { nome: 'Listar Pedidos', endpoint: '/api/pedidos', esperado: [200, 401] },
        { nome: 'Kanban Status', endpoint: '/api/kanban/orcamentos', esperado: [200, 401] },
    ],
    'Financeiro': [
        { nome: 'Resumo Financeiro', endpoint: '/api/financeiro/resumo', esperado: [200, 401] },
        { nome: 'Contas a Pagar', endpoint: '/api/financeiro/contas-pagar', esperado: [200, 401] },
        { nome: 'Contas a Receber', endpoint: '/api/financeiro/contas-receber', esperado: [200, 401] },
        { nome: 'Fluxo de Caixa', endpoint: '/api/financeiro/fluxo-caixa', esperado: [200, 401] },
    ],
    'Compras': [
        { nome: 'Listar Fornecedores', endpoint: '/api/compras/fornecedores', esperado: [200, 401] },
        { nome: 'Pedidos de Compra', endpoint: '/api/compras/pedidos', esperado: [200, 401] },
        { nome: 'Cotações', endpoint: '/api/compras/cotacoes', esperado: [200, 401] },
    ],
    'RH': [
        { nome: 'Listar Funcionários', endpoint: '/api/rh/funcionarios', esperado: [200, 401] },
        { nome: 'Folha de Pagamento', endpoint: '/api/rh/folha', esperado: [200, 401] },
    ],
    'Faturamento': [
        { nome: 'Listar NF-e', endpoint: '/api/nfe', esperado: [200, 401] },
        { nome: 'Estatísticas NF-e', endpoint: '/api/nfe/estatisticas', esperado: [200, 401] },
    ],
    'Logística': [
        { nome: 'Transportadoras', endpoint: '/api/logistica/transportadoras', esperado: [200, 401] },
        { nome: 'Pedidos Logística', endpoint: '/api/logistica/pedidos', esperado: [200, 401] },
    ],
    'Dashboard': [
        { nome: 'Dashboard Executivo', endpoint: '/api/dashboard-executivo/resumo', esperado: [200, 401] },
        { nome: 'Notificações', endpoint: '/api/notificacoes', esperado: [200, 401] },
    ],
};

async function executarTestes() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     TESTE COMPLETO DOS MÓDULOS ALUFORCE                      ║');
    console.log('║     Data: ' + new Date().toLocaleString('pt-BR') + '                         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    let totalTestes = 0;
    let testesOk = 0;
    let testesFalha = 0;
    const resultados = {};

    for (const [modulo, tests] of Object.entries(testes)) {
        console.log(`\n📦 MÓDULO: ${modulo}`);
        console.log('─'.repeat(50));
        resultados[modulo] = { ok: 0, falha: 0 };

        for (const teste of tests) {
            totalTestes++;
            try {
                const resultado = await request(teste.endpoint);
                const esperados = Array.isArray(teste.esperado) ? teste.esperado : [teste.esperado];
                
                if (esperados.includes(resultado.status)) {
                    console.log(`  ✅ ${teste.nome} (${resultado.status})`);
                    testesOk++;
                    resultados[modulo].ok++;
                } else {
                    console.log(`  ❌ ${teste.nome} - Status: ${resultado.status} (Esperado: ${teste.esperado})`);
                    testesFalha++;
                    resultados[modulo].falha++;
                }
            } catch (err) {
                console.log(`  ❌ ${teste.nome} - Erro: ${err.message}`);
                testesFalha++;
                resultados[modulo].falha++;
            }
        }
    }

    // Resumo
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                       RESUMO DOS TESTES                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    
    for (const [modulo, res] of Object.entries(resultados)) {
        const status = res.falha === 0 ? '✅' : '⚠️';
        console.log(`║  ${status} ${modulo.padEnd(20)} OK: ${res.ok.toString().padStart(2)} | Falha: ${res.falha.toString().padStart(2)}     ║`);
    }
    
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total: ${totalTestes} testes | ✅ ${testesOk} OK | ❌ ${testesFalha} Falhas            ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Taxa de sucesso
    const taxa = ((testesOk / totalTestes) * 100).toFixed(1);
    if (taxa >= 80) {
        console.log(`🎉 Taxa de sucesso: ${taxa}% - SISTEMA OPERACIONAL!\n`);
    } else if (taxa >= 50) {
        console.log(`⚠️  Taxa de sucesso: ${taxa}% - Verificar endpoints com falha\n`);
    } else {
        console.log(`❌ Taxa de sucesso: ${taxa}% - Múltiplos problemas detectados\n`);
    }

    process.exit(testesFalha > 0 ? 1 : 0);
}

// Aguardar servidor iniciar
console.log('⏳ Aguardando servidor (3 segundos)...');
setTimeout(executarTestes, 3000);
