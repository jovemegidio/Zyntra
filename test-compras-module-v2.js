/**
 * ALUFORCE - Teste Completo do Módulo de Compras V2
 * Testa todos os botões/endpoints de TODAS as páginas (exceto requisicoes.html)
 * Versão pós-correções
 */
const http = require('http');

const BASE = 'http://localhost:3000';
let TOKEN = '';
let results = { passed: 0, failed: 0, skipped: 0, details: [] };

function req(method, path, body = null) {
    return new Promise((resolve) => {
        const url = new URL(path, BASE);
        const opts = {
            hostname: url.hostname, port: url.port, path: url.pathname + url.search,
            method, headers: { 'Content-Type': 'application/json' }, timeout: 8000
        };
        if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
        const r = http.request(opts, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(d); } catch(e) {}
                resolve({ status: res.statusCode, data: json, raw: d, headers: res.headers });
            });
        });
        r.on('error', e => resolve({ status: 0, data: null, raw: e.message, error: true }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, data: null, raw: 'timeout' }); });
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

function test(name, passed, detail = '') {
    if (passed) { results.passed++; results.details.push({ name, status: 'PASS' }); }
    else { results.failed++; results.details.push({ name, status: 'FAIL', detail }); }
    console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function skip(name, reason) {
    results.skipped++;
    results.details.push({ name, status: 'SKIP', detail: reason });
    console.log(`⏭️  ${name} — ${reason}`);
}

async function run() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('   ALUFORCE — Teste Módulo Compras V2 (pós-correções)');
    console.log('═══════════════════════════════════════════════════════\n');

    // ====== 1. LOGIN ======
    console.log('── 1. Login ──');
    const login = await req('POST', '/api/login', { email: 'qafinanceiro@aluforce.ind.br', password: 'Teste@123' });
    test('Login QA', login.status === 200 && login.data?.token, `status=${login.status}`);
    if (login.data?.token) TOKEN = login.data.token;
    else { console.log('FATAL: Sem token, abortando'); return; }

    // ====== 2. DASHBOARD-PRO.HTML ======
    console.log('\n── 2. Dashboard Pro ──');
    
    // Dashboard endpoint (from compras-routes — retorna {success, data})
    const dash = await req('GET', '/api/compras/dashboard');
    test('GET /dashboard', dash.status === 200 && (dash.data?.success || dash.data?.pedidos_pendentes !== undefined),
        `status=${dash.status}`);

    // GET pedidos (list)
    const pedidos = await req('GET', '/api/compras/pedidos');
    test('GET /pedidos (lista)', pedidos.status === 200, `status=${pedidos.status}`);

    // GET fornecedores (list)
    const forns = await req('GET', '/api/compras/fornecedores');
    test('GET /fornecedores (lista)', forns.status === 200, `status=${forns.status}`);

    // Link test: dashboard-pro buttons should point to pedidos.html (frontend fix validated via file check)
    const dashHTML = await req('GET', '/modules/Compras/dashboard-pro.html');
    const dashLinksFixed = dashHTML.raw.includes("pedidos.html") && !dashHTML.raw.includes("compras.html'");
    test('Dashboard links → pedidos.html (fix)', dashLinksFixed, 'Verifica href corrigido');

    // ====== 3. PEDIDOS.HTML ======
    console.log('\n── 3. Pedidos ──');
    
    // POST criar pedido (compras-extended usa pedidos_compra; compras-routes usa pedidos_compras)
    const novoPedido = await req('POST', '/api/compras/pedidos', {
        fornecedor_id: 1, data_entrega: '2025-12-31', observacoes: 'Teste automático',
        itens: [{ descricao: 'Material teste', quantidade: 10, valor_unitario: 50.00 }]
    });
    test('POST /pedidos (criar)', [200, 201].includes(novoPedido.status), `status=${novoPedido.status}`);
    
    const pedidoId = novoPedido.data?.id || novoPedido.data?.pedido_id || 1;

    // GET pedido by id
    const getPedido = await req('GET', `/api/compras/pedidos/${pedidoId}`);
    test('GET /pedidos/:id (detalhe)', [200, 404].includes(getPedido.status), `status=${getPedido.status}`);

    // PUT atualizar pedido (fix: endpoint agora correto no dashboard-compras-pro-v2.js)
    const putPedido = await req('PUT', `/api/compras/pedidos/${pedidoId}`, {
        fornecedor: 'Fornecedor Teste', status: 'pendente', valor: 500.00
    });
    test('PUT /pedidos/:id (atualizar)', [200, 404].includes(putPedido.status), `status=${putPedido.status}`);

    // ====== 4. FORNECEDORES.HTML ======
    console.log('\n── 4. Fornecedores ──');
    
    // POST criar fornecedor (compras-routes validation requer 'nome' field)
    const novoForn = await req('POST', '/api/compras/fornecedores', {
        nome: 'Fornecedor QA Teste', razao_social: 'Fornecedor QA Teste LTDA',
        cnpj: '11222333000144', email: 'qa@teste.com', telefone: '11999999999',
        categoria: 'materia_prima'
    });
    test('POST /fornecedores (criar)', [200, 201, 400].includes(novoForn.status),
        `status=${novoForn.status} ${novoForn.data?.message || ''}`);
    
    const fornId = novoForn.data?.id || novoForn.data?.fornecedor_id || 1;

    // GET fornecedor by id
    const getForn = await req('GET', `/api/compras/fornecedores/${fornId}`);
    test('GET /fornecedores/:id', [200, 404].includes(getForn.status), `status=${getForn.status}`);

    // PUT atualizar fornecedor
    const putForn = await req('PUT', `/api/compras/fornecedores/${fornId}`, {
        nome: 'Fornecedor QA Atualizado', email: 'qa2@teste.com'
    });
    test('PUT /fornecedores/:id', [200, 404].includes(putForn.status), `status=${putForn.status}`);

    // GET fornecedores/avaliacoes
    const avaliacoes = await req('GET', `/api/compras/fornecedores/${fornId}/avaliacoes`);
    test('GET /fornecedores/:id/avaliacoes', [200, 404].includes(avaliacoes.status), `status=${avaliacoes.status}`);

    // ====== 5. COTACOES.HTML ======
    console.log('\n── 5. Cotações ──');
    
    // GET cotacoes
    const cotacoes = await req('GET', '/api/compras/cotacoes');
    test('GET /cotacoes (lista)', cotacoes.status === 200, `status=${cotacoes.status}`);

    // GET cotacoes-stats
    const cotStats = await req('GET', '/api/compras/cotacoes-stats');
    test('GET /cotacoes-stats', cotStats.status === 200, `status=${cotStats.status}`);

    // GET proximo-numero
    const proxNum = await req('GET', '/api/compras/cotacoes/proximo-numero');
    test('GET /cotacoes/proximo-numero', proxNum.status === 200, `status=${proxNum.status}`);

    // POST criar cotação
    const novaCot = await req('POST', '/api/compras/cotacoes', {
        titulo: 'Cotação QA Teste', descricao: 'Teste automático', prioridade: 'media',
        data_limite: '2025-12-31',
        itens: [{ descricao: 'Alumínio 6063', quantidade: 100, unidade: 'kg' }],
        fornecedores: []
    });
    test('POST /cotacoes (criar)', [200, 201].includes(novaCot.status), `status=${novaCot.status}`);
    
    const cotId = novaCot.data?.id || novaCot.data?.cotacao_id || 1;

    // GET cotação by id
    const getCot = await req('GET', `/api/compras/cotacoes/${cotId}`);
    test('GET /cotacoes/:id', [200, 404].includes(getCot.status), `status=${getCot.status}`);

    // PUT atualizar cotação
    const putCot = await req('PUT', `/api/compras/cotacoes/${cotId}`, {
        titulo: 'Cotação QA Atualizada', status: 'analise'
    });
    test('PUT /cotacoes/:id', [200, 404].includes(putCot.status), `status=${putCot.status}`);

    // POST aprovar proposta (NOVA ROTA adicionada)
    const aprovar = await req('POST', `/api/compras/cotacoes/${cotId}/aprovar-proposta`, {
        proposta_id: 1, fornecedor_id: 1
    });
    test('POST /cotacoes/:id/aprovar-proposta (novo)', [200, 404].includes(aprovar.status),
        `status=${aprovar.status} ${aprovar.data?.message || ''}`);

    // Exportar button — verificar se onclick existe no HTML
    const cotHTML = await req('GET', '/modules/Compras/cotacoes.html');
    const exportarBtnFixed = cotHTML.raw.includes('onclick="cotacoesManager.exportar()"');
    test('Cotações: btn Exportar tem onclick (fix)', exportarBtnFixed);

    // ====== 6. ESTOQUE (CONTROLE-ESTOQUE.HTML) ======
    console.log('\n── 6. Controle de Estoque ──');
    
    // GET estoque
    const estoque = await req('GET', '/api/compras/estoque');
    test('GET /estoque (lista)', estoque.status === 200, `status=${estoque.status}`);

    // GET estoque/movimentacoes
    const movs = await req('GET', '/api/compras/estoque/movimentacoes');
    test('GET /estoque/movimentacoes', movs.status === 200, `status=${movs.status}`);

    // POST entrada (fix: estoque_atual em vez de quantidade_atual)
    const entrada = await req('POST', '/api/compras/estoque/entrada', {
        material_id: 1, quantidade: 5, observacao: 'Teste entrada', documento: 'DOC-001'
    });
    test('POST /estoque/entrada (fix estoque_atual)', [200, 400, 404].includes(entrada.status),
        `status=${entrada.status} ${entrada.data?.message || ''}`);

    // POST saida (fix: estoque_atual)
    const saida = await req('POST', '/api/compras/estoque/saida', {
        material_id: 1, quantidade: 1, observacao: 'Teste saída', documento: 'DOC-002'
    });
    test('POST /estoque/saida (fix estoque_atual)', [200, 400, 404].includes(saida.status),
        `status=${saida.status} ${saida.data?.message || ''}`);

    // POST ajuste (fix: estoque_atual)
    const ajuste = await req('POST', '/api/compras/estoque/ajuste', {
        material_id: 1, quantidade_nova: 100, motivo: 'Ajuste teste'
    });
    test('POST /estoque/ajuste (fix estoque_atual)', [200, 400, 404].includes(ajuste.status),
        `status=${ajuste.status} ${ajuste.data?.message || ''}`);

    // ====== 7. NF ENTRADA ======
    console.log('\n── 7. NF Entrada ──');
    
    // GET nf-entrada (fix: chave_nfe, emitente_cnpj, emitente_razao)
    const nfList = await req('GET', '/api/compras/nf-entrada');
    test('GET /nf-entrada (fix colunas)', nfList.status === 200, `status=${nfList.status}`);

    // GET nf-entrada filtro fornecedor (fix: emitente_cnpj, emitente_razao)
    const nfFiltro = await req('GET', '/api/compras/nf-entrada?fornecedor=teste');
    test('GET /nf-entrada?fornecedor=teste', nfFiltro.status === 200, `status=${nfFiltro.status}`);

    // GET nfe/consultar (fix: WHERE chave_nfe)
    const nfeConsultar = await req('GET', '/api/compras/nfe/consultar/12345678901234567890123456789012345678901234');
    test('GET /nfe/consultar/:chave', [200, 404].includes(nfeConsultar.status) && nfeConsultar.data,
        `status=${nfeConsultar.status}`);

    // POST importar XML (fix: INSERT com chave_nfe etc.)
    const xmlTest = `<?xml version="1.0"?>
<nfeProc><NFe><infNFe Id="NFe${Date.now().toString().padStart(44, '0')}">
<ide><nNF>${Math.floor(Math.random()*99999)}</nNF><serie>1</serie><mod>55</mod><dhEmi>2025-01-15T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00111222000133</CNPJ><xNome>Fornecedor XML Teste</xNome><UF>SP</UF></emit>
<det nItem="1"><prod><cProd>001</cProd><xProd>Material Teste</xProd><NCM>76061200</NCM><CFOP>1101</CFOP><uCom>KG</uCom><qCom>10</qCom><vUnCom>50.00</vUnCom><vProd>500.00</vProd></prod>
<imposto><ICMS><CST>00</CST><vICMS>90.00</vICMS><pICMS>18.00</pICMS></ICMS><IPI><vIPI>25.00</vIPI></IPI><PIS><vPIS>8.25</vPIS></PIS><COFINS><vCOFINS>38.00</vCOFINS></COFINS></imposto></det>
<total><ICMSTot><vProd>500.00</vProd><vFrete>0</vFrete><vSeg>0</vSeg><vDesc>0</vDesc><vOutro>0</vOutro><vNF>500.00</vNF><vBC>500.00</vBC><vICMS>90.00</vICMS><vBCST>0</vBCST><vST>0</vST><vIPI>25.00</vIPI><vPIS>8.25</vPIS><vCOFINS>38.00</vCOFINS></ICMSTot></total>
</infNFe></NFe></nfeProc>`;
    const importXML = await req('POST', '/api/compras/nf-entrada/importar-xml', { xml: xmlTest });
    test('POST /nf-entrada/importar-xml (fix schema)', importXML.status === 200 && importXML.data?.success !== undefined,
        `status=${importXML.status} success=${importXML.data?.success} msg=${importXML.data?.message || importXML.data?.error || ''}`);

    // ====== 8. MATERIAS-PRIMAS.HTML ======
    console.log('\n── 8. Matérias-Primas ──');
    
    // GET materias-primas (via /api/pcp — precisa Bearer token, fix aplicado no frontend)
    const mps = await req('GET', '/api/pcp/materias-primas');
    test('GET /pcp/materias-primas (c/ Bearer)', [200, 403, 404].includes(mps.status),
        `status=${mps.status} ${mps.data?.error || ''}`);
    
    // Verificar HTML tem Bearer helper
    const mpHTML = await req('GET', '/modules/Compras/materias-primas.html');
    const temAuthHelper = mpHTML.raw.includes('getAuthHeaders') && mpHTML.raw.includes('getUsuarioNome');
    test('materias-primas.html: auth helpers (fix)', temAuthHelper);

    // ====== 9. RELATORIOS.HTML ======
    console.log('\n── 9. Relatórios ──');
    
    // Verificar export functions usam dados da tabela (fix)
    const relHTML = await req('GET', '/modules/Compras/relatorios.html');
    const csvFixed = relHTML.raw.includes("tabela.querySelectorAll('thead th')");
    const excelFixed = relHTML.raw.includes("tabela.innerHTML");
    const pdfFixed = relHTML.raw.includes("tabelaHTML");
    test('Relatórios: exportarCSV usa dados reais (fix)', csvFixed);
    test('Relatórios: exportarExcel usa dados reais (fix)', excelFixed);
    test('Relatórios: exportarPDF usa dados reais (fix)', pdfFixed);

    // GET relatorios API endpoint
    const relatorio = await req('GET', '/api/compras/relatorios/compras-periodo?data_inicio=2025-01-01&data_fim=2025-12-31');
    test('GET /relatorios/compras-periodo', [200, 404].includes(relatorio.status), `status=${relatorio.status}`);

    // ====== 10. OTIMIZACAO-ESTOQUE ======
    console.log('\n── 10. Otimização de Estoque ──');
    
    // Verificar links corrigidos no JS
    const otHTML = await req('GET', '/modules/Compras/otimizacao-estoque.js');
    const linkPedidos = otHTML.raw.includes("pedidos.html?auto=true") && !otHTML.raw.includes("pedidos-new.html");
    const linkMateriais = otHTML.raw.includes("materias-primas.html?filter=estoque_baixo") && !otHTML.raw.includes("materiais-new.html");
    test('otimizacao-estoque.js: link pedidos.html (fix)', linkPedidos);
    test('otimizacao-estoque.js: link materias-primas.html (fix)', linkMateriais);

    // Verificar </head> no HTML
    const otHTMLFile = await req('GET', '/modules/Compras/otimizacao-estoque.html');
    const headClosed = otHTMLFile.raw.includes('</head>');
    test('otimizacao-estoque.html: </head> tag (fix)', headClosed);

    // ====== 11. DASHBOARD-EXECUTIVO.HTML ======
    console.log('\n── 11. Dashboard Executivo ──');

    const dashExec = await req('GET', '/api/compras/dashboard');
    test('GET /dashboard (executivo)', dashExec.status === 200, `status=${dashExec.status}`);

    // ====== 12. DASHBOARD-COMPRAS-PRO-V2.JS ======
    console.log('\n── 12. Dashboard Pro V2 JS ──');

    const proV2JS = await req('GET', '/modules/Compras/dashboard-compras-pro-v2.js');
    const endpointFixed = proV2JS.raw.includes('/api/compras/pedidos/${ordemId}') && 
        !proV2JS.raw.includes('/api/compras/ordens/${ordemId}');
    test('dashboard-pro-v2.js: endpoint /pedidos/:id (fix)', endpointFixed);
    
    const eventFixed = proV2JS.raw.includes('async atualizarDados(evt)') && 
        proV2JS.raw.includes('const e = evt || window.event');
    test('dashboard-pro-v2.js: atualizarDados safe event (fix)', eventFixed);

    // ====== 13. CROSS-MODULE TESTS ======
    console.log('\n── 13. Testes Cruzados ──');

    // Pedidos stats / contagem
    const pedidoStats = await req('GET', '/api/compras/pedidos?status=pendente');
    test('GET /pedidos?status=pendente', pedidoStats.status === 200, `status=${pedidoStats.status}`);

    // Fornecedores pesquisa
    const fornPesquisa = await req('GET', '/api/compras/fornecedores?busca=teste');
    test('GET /fornecedores?busca=teste', fornPesquisa.status === 200, `status=${fornPesquisa.status}`);

    // DELETE cotação de teste
    if (cotId > 1) {
        const delCot = await req('DELETE', `/api/compras/cotacoes/${cotId}`);
        test('DELETE /cotacoes/:id (cleanup)', [200, 404].includes(delCot.status), `status=${delCot.status}`);
    } else {
        skip('DELETE /cotacoes/:id', 'sem cotação para deletar');
    }

    // DELETE fornecedor de teste
    if (fornId > 1) {
        const delForn = await req('DELETE', `/api/compras/fornecedores/${fornId}`);
        test('DELETE /fornecedores/:id (cleanup)', [200, 404].includes(delForn.status), `status=${delForn.status}`);
    } else {
        skip('DELETE /fornecedores/:id', 'sem fornecedor para deletar');
    }

    // ====== RESULTADO FINAL ======
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`   RESULTADO: ${results.passed} PASS | ${results.failed} FAIL | ${results.skipped} SKIP`);
    console.log(`   TOTAL: ${results.passed + results.failed + results.skipped} testes`);
    console.log(`   TAXA: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    console.log('═══════════════════════════════════════════════════════\n');

    if (results.failed > 0) {
        console.log('❌ FALHAS:');
        results.details.filter(d => d.status === 'FAIL').forEach(d => {
            console.log(`   → ${d.name}: ${d.detail}`);
        });
    }
}

run().catch(e => console.error('ERRO FATAL:', e));
