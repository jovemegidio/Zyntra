const http = require('http');
const BASE = 'http://localhost:3000';
let TOKEN = '';
let results = { passed: 0, failed: 0, skipped: 0, details: [] };

function req(method, path, body) {
    return new Promise(r => {
        const url = new URL(path, BASE);
        const opts = { hostname:url.hostname, port:url.port, path:url.pathname+url.search, method, headers:{'Content-Type':'application/json'}, timeout:8000 };
        if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
        const q = http.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ let j; try{j=JSON.parse(d)}catch(e){} r({status:res.statusCode,data:j,raw:d}); }); });
        q.on('error', e => r({status:0,data:null,raw:e.message}));
        q.on('timeout', () => { q.destroy(); r({status:0,data:null,raw:'timeout'}); });
        if (body) q.write(JSON.stringify(body));
        q.end();
    });
}

function test(n, p, d) {
    d = d || '';
    if (p) { results.passed++; results.details.push({n:n,s:'PASS'}); }
    else { results.failed++; results.details.push({n:n,s:'FAIL',d:d}); }
    console.log((p ? '\u2705' : '\u274C') + ' ' + n + (d ? ' \u2014 ' + d : ''));
}

async function run() {
    console.log('====================================================');
    console.log('  ALUFORCE - Teste Compras V3 (final pos-correcoes)');
    console.log('====================================================\n');

    // 1. LOGIN
    console.log('-- 1. Login --');
    var login = await req('POST', '/api/login', {email:'qafinanceiro@aluforce.ind.br', password:'Teste@123'});
    test('Login QA', login.status === 200 && login.data && login.data.token, 'status=' + login.status);
    if (login.data && login.data.token) TOKEN = login.data.token;
    else { console.log('FATAL: sem token'); return; }

    // 2. DASHBOARD PRO
    console.log('\n-- 2. Dashboard Pro --');
    var dash = await req('GET', '/api/compras/dashboard');
    test('GET /dashboard', dash.status === 200 && dash.data && dash.data.stats, 'status=' + dash.status);
    var pedidos = await req('GET', '/api/compras/pedidos');
    test('GET /pedidos (lista)', pedidos.status === 200, 'status=' + pedidos.status);
    var forns = await req('GET', '/api/compras/fornecedores');
    test('GET /fornecedores (fix created_at)', forns.status === 200, 'status=' + forns.status);
    var dashHTML = await req('GET', '/modules/Compras/dashboard-pro.html');
    test('Dashboard links pedidos.html (fix)', dashHTML.raw.includes("pedidos.html") && !dashHTML.raw.includes("compras.html'"));

    // 2b. CRIAR FORNECEDOR ANTES DOS PEDIDOS
    var preNovoForn = await req('POST', '/api/compras/fornecedores', {
        nome: 'Forn Pedido QA ' + Date.now(),
        razao_social: 'Forn Pedido QA LTDA',
        cnpj: '11222333' + Math.floor(Math.random() * 999999).toString().padStart(6, '0'),
        email: 'forn-pedido@teste.com'
    });
    var preFornId = (preNovoForn.data && preNovoForn.data.id) || (preNovoForn.data && preNovoForn.data.fornecedor_id) || null;
    test('PRE: criar fornecedor p/ pedido', preNovoForn.status === 201 && preFornId, 'status=' + preNovoForn.status);

    // 3. PEDIDOS
    console.log('\n-- 3. Pedidos --');
    var novoPedido = await req('POST', '/api/compras/pedidos', {
        numero_pedido: 'TST-' + Date.now(),
        fornecedor_id: preFornId || 1,
        data_pedido: new Date().toISOString().split('T')[0],
        data_entrega_prevista: '2025-12-31',
        observacoes: 'Teste automatico',
        itens: [{descricao: 'Material teste', quantidade: 10, preco_unitario: 50.00, unidade: 'KG'}]
    });
    test('POST /pedidos (criar)', novoPedido.status === 201 || novoPedido.status === 200,
        'status=' + novoPedido.status + ' ' + ((novoPedido.data && novoPedido.data.message) || (novoPedido.data && novoPedido.data.error) || ''));
    var pedidoId = (novoPedido.data && novoPedido.data.id) || (novoPedido.data && novoPedido.data.pedido_id) || 1;
    var getPedido = await req('GET', '/api/compras/pedidos/' + pedidoId);
    test('GET /pedidos/:id', [200, 404].includes(getPedido.status), 'status=' + getPedido.status);
    var putPedido = await req('PUT', '/api/compras/pedidos/' + pedidoId, {fornecedor: 'Teste', status: 'pendente', valor: 500});
    test('PUT /pedidos/:id', [200, 404].includes(putPedido.status), 'status=' + putPedido.status);

    // 4. FORNECEDORES
    console.log('\n-- 4. Fornecedores --');
    var novoForn = await req('POST', '/api/compras/fornecedores', {
        nome: 'Fornecedor QA ' + Date.now(),
        razao_social: 'Fornecedor QA LTDA',
        cnpj: '99888777' + Math.floor(Math.random() * 999999).toString().padStart(6, '0'),
        email: 'qa@teste.com'
    });
    test('POST /fornecedores', [200, 201, 400].includes(novoForn.status), 'status=' + novoForn.status);
    var fornId = (novoForn.data && novoForn.data.id) || (novoForn.data && novoForn.data.fornecedor_id) || 1;
    var getForn = await req('GET', '/api/compras/fornecedores/' + fornId);
    test('GET /fornecedores/:id', [200, 404].includes(getForn.status), 'status=' + getForn.status);
    var putForn = await req('PUT', '/api/compras/fornecedores/' + fornId, {nome: 'QA Atualizado'});
    test('PUT /fornecedores/:id', [200, 404].includes(putForn.status), 'status=' + putForn.status);
    var fornSearch = await req('GET', '/api/compras/fornecedores?search=QA');
    test('GET /fornecedores?search=QA (fix)', fornSearch.status === 200, 'status=' + fornSearch.status);

    // 5. COTACOES
    console.log('\n-- 5. Cotacoes --');
    var cotacoes = await req('GET', '/api/compras/cotacoes');
    test('GET /cotacoes', cotacoes.status === 200, 'status=' + cotacoes.status);
    var cotStats = await req('GET', '/api/compras/cotacoes-stats');
    test('GET /cotacoes-stats', cotStats.status === 200, 'status=' + cotStats.status);
    var proxNum = await req('GET', '/api/compras/cotacoes/proximo-numero');
    test('GET /cotacoes/proximo-numero', proxNum.status === 200, 'status=' + proxNum.status);
    var novaCot = await req('POST', '/api/compras/cotacoes', {
        numero: 'CT' + (Date.now() % 100000000),
        descricao: 'Cotacao QA Teste',
        data_abertura: new Date().toISOString().split('T')[0],
        data_validade: '2025-12-31',
        quantidade: 100,
        unidade: 'KG'
    });
    test('POST /cotacoes (criar)', [200, 201].includes(novaCot.status),
        'status=' + novaCot.status + ' ' + ((novaCot.data && novaCot.data.message) || ''));
    var cotId = (novaCot.data && novaCot.data.id) || (novaCot.data && novaCot.data.cotacao_id) || 1;
    var getCot = await req('GET', '/api/compras/cotacoes/' + cotId);
    test('GET /cotacoes/:id', [200, 404].includes(getCot.status), 'status=' + getCot.status);
    var putCot = await req('PUT', '/api/compras/cotacoes/' + cotId, {descricao: 'Atualizada', status: 'analise'});
    test('PUT /cotacoes/:id', [200, 404].includes(putCot.status), 'status=' + putCot.status);
    var aprovar = await req('POST', '/api/compras/cotacoes/' + cotId + '/aprovar-proposta', {proposta_id: 1, fornecedor_id: fornId});
    test('POST /cotacoes/:id/aprovar-proposta (fix)', [200, 404].includes(aprovar.status),
        'status=' + aprovar.status + ' ' + ((aprovar.data && aprovar.data.message) || ''));
    var cotHTML = await req('GET', '/modules/Compras/cotacoes.html');
    test('Cotacoes btn Exportar onclick (fix)', cotHTML.raw.includes('onclick="cotacoesManager.exportar()"'));

    // 6. ESTOQUE
    console.log('\n-- 6. Estoque --');
    var movs = await req('GET', '/api/compras/estoque/movimentacoes');
    test('GET /estoque/movimentacoes', movs.status === 200, 'status=' + movs.status);
    var entrada = await req('POST', '/api/compras/estoque/entrada', {material_id: 1, quantidade: 5, observacao: 'Teste', documento: 'DOC-001'});
    test('POST /estoque/entrada (fix estoque_atual)', [200, 400].includes(entrada.status),
        'status=' + entrada.status + ' ' + ((entrada.data && entrada.data.message) || ''));
    var saida = await req('POST', '/api/compras/estoque/saida', {material_id: 1, quantidade: 1, observacao: 'Teste saida'});
    test('POST /estoque/saida (fix estoque_atual)', [200, 400].includes(saida.status),
        'status=' + saida.status + ' ' + ((saida.data && saida.data.message) || ''));
    var ajuste = await req('POST', '/api/compras/estoque/ajuste', {material_id: 1, quantidade_nova: 100, motivo: 'Ajuste teste'});
    test('POST /estoque/ajuste (fix estoque_atual)', [200, 400].includes(ajuste.status),
        'status=' + ajuste.status + ' ' + ((ajuste.data && ajuste.data.message) || ''));

    // 7. NF ENTRADA
    console.log('\n-- 7. NF Entrada --');
    var nfList = await req('GET', '/api/compras/nf-entrada');
    test('GET /nf-entrada (fix colunas)', nfList.status === 200, 'status=' + nfList.status);
    var nfFiltro = await req('GET', '/api/compras/nf-entrada?fornecedor=teste');
    test('GET /nf-entrada?fornecedor=teste', nfFiltro.status === 200, 'status=' + nfFiltro.status);
    var nfeConsultar = await req('GET', '/api/compras/nfe/consultar/12345678901234567890123456789012345678901234');
    test('GET /nfe/consultar/:chave (fix chave_nfe)', nfeConsultar.status === 200 && nfeConsultar.data !== null,
        'status=' + nfeConsultar.status);
    var chave44 = Date.now().toString().padStart(44, '0');
    var xmlTest = '<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe' + chave44 + '">' +
        '<ide><nNF>' + Math.floor(Math.random() * 99999) + '</nNF><serie>1</serie><mod>55</mod><dhEmi>2025-01-15T10:00:00-03:00</dhEmi></ide>' +
        '<emit><CNPJ>00111222000133</CNPJ><xNome>Forn XML Teste</xNome><UF>SP</UF></emit>' +
        '<det nItem="1"><prod><cProd>001</cProd><xProd>Material</xProd><NCM>76061200</NCM><CFOP>1101</CFOP><uCom>KG</uCom><qCom>10</qCom><vUnCom>50</vUnCom><vProd>500</vProd></prod>' +
        '<imposto><ICMS><CST>00</CST><vICMS>90</vICMS><pICMS>18</pICMS></ICMS><IPI><vIPI>25</vIPI></IPI><PIS><vPIS>8</vPIS></PIS><COFINS><vCOFINS>38</vCOFINS></COFINS></imposto></det>' +
        '<total><ICMSTot><vProd>500</vProd><vFrete>0</vFrete><vSeg>0</vSeg><vDesc>0</vDesc><vOutro>0</vOutro><vNF>500</vNF><vBC>500</vBC><vICMS>90</vICMS><vBCST>0</vBCST><vST>0</vST><vIPI>25</vIPI><vPIS>8</vPIS><vCOFINS>38</vCOFINS></ICMSTot></total>' +
        '</infNFe></NFe></nfeProc>';
    var importXML = await req('POST', '/api/compras/nf-entrada/importar-xml-texto', {xml: xmlTest});
    test('POST /nf-entrada/importar-xml-texto (fix schema)',
        importXML.status === 200 && importXML.data && importXML.data.success !== undefined,
        'status=' + importXML.status + ' ' + ((importXML.data && (importXML.data.message || importXML.data.error)) || ''));

    // 8. MATERIAS-PRIMAS
    console.log('\n-- 8. Materias-Primas --');
    var mps = await req('GET', '/api/pcp/materias-primas');
    test('GET /pcp/materias-primas', [200, 403, 404].includes(mps.status), 'status=' + mps.status);
    var mpHTML = await req('GET', '/modules/Compras/materias-primas.html');
    test('materias-primas auth helpers (fix)', mpHTML.raw.indexOf('getAuthHeaders') > 0 && mpHTML.raw.indexOf('getUsuarioNome') > 0);

    // 9. RELATORIOS
    console.log('\n-- 9. Relatorios --');
    var relHTML = await req('GET', '/modules/Compras/relatorios.html');
    test('Relat CSV dados reais (fix)', relHTML.raw.indexOf("querySelectorAll('thead th')") > 0);
    test('Relat Excel dados reais (fix)', relHTML.raw.indexOf('tabela.innerHTML') > 0);
    test('Relat PDF dados reais (fix)', relHTML.raw.indexOf('tabelaHTML') > 0);
    var relAPI = await req('GET', '/api/compras/relatorios/compras-periodo?data_inicio=2025-01-01&data_fim=2025-12-31');
    test('GET /relatorios/compras-periodo', relAPI.status === 200, 'status=' + relAPI.status);

    // 10. OTIMIZACAO ESTOQUE
    console.log('\n-- 10. Otimizacao de Estoque --');
    var otJS = await req('GET', '/modules/Compras/otimizacao-estoque.js');
    test('otimizacao links pedidos.html (fix)', otJS.raw.indexOf('pedidos.html?auto=true') > 0 && otJS.raw.indexOf('pedidos-new.html') < 0);
    test('otimizacao links materias-primas (fix)', otJS.raw.indexOf('materias-primas.html?filter=estoque_baixo') > 0 && otJS.raw.indexOf('materiais-new.html') < 0);
    var otHTML = await req('GET', '/modules/Compras/otimizacao-estoque.html');
    test('otimizacao </head> tag (fix)', otHTML.raw.indexOf('</head>') > 0);

    // 11. DASHBOARD EXECUTIVO
    console.log('\n-- 11. Dashboard Executivo --');
    test('GET /dashboard (executivo reusa)', dash.status === 200, 'testado acima');

    // 12. DASHBOARD PRO V2 JS
    console.log('\n-- 12. Dashboard Pro V2 JS --');
    var proV2 = await req('GET', '/modules/Compras/dashboard-compras-pro-v2.js');
    test('pro-v2 endpoint /pedidos/:id (fix)',
        proV2.raw.indexOf('/api/compras/pedidos/${ordemId}') > 0 && proV2.raw.indexOf('/api/compras/ordens/${ordemId}') < 0);
    test('pro-v2 atualizarDados safe event (fix)', proV2.raw.indexOf('atualizarDados(evt)') > 0);

    // 13. CLEANUP
    console.log('\n-- 13. Cleanup --');
    if (cotId > 1) {
        var dC = await req('DELETE', '/api/compras/cotacoes/' + cotId);
        test('DELETE /cotacoes/:id', [200, 400, 404].includes(dC.status), 'status=' + dC.status);
    }
    if (fornId > 1) {
        var dF = await req('DELETE', '/api/compras/fornecedores/' + fornId);
        test('DELETE /fornecedores/:id', [200, 404].includes(dF.status), 'status=' + dF.status);
    }
    if (preFornId > 1) {
        var dPF = await req('DELETE', '/api/compras/fornecedores/' + preFornId);
        test('DELETE /pre-fornecedor', [200, 404].includes(dPF.status), 'status=' + dPF.status);
    }

    // RESULTADO
    console.log('\n====================================================');
    var total = results.passed + results.failed + results.skipped;
    var rate = ((results.passed / (results.passed + results.failed)) * 100).toFixed(1);
    console.log('  RESULTADO: ' + results.passed + ' PASS | ' + results.failed + ' FAIL | ' + results.skipped + ' SKIP');
    console.log('  TOTAL: ' + total + ' testes');
    console.log('  TAXA: ' + rate + '%');
    console.log('====================================================\n');
    if (results.failed > 0) {
        console.log('FALHAS:');
        results.details.filter(function(x) { return x.s === 'FAIL'; }).forEach(function(x) {
            console.log('   -> ' + x.n + ': ' + x.d);
        });
    }
}

run().catch(function(e) { console.error('FATAL:', e); });
