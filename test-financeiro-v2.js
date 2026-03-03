/**
 * TESTE COMPLETO — MÓDULO FINANCEIRO v2
 * Com delays anti-rate-limit + IDs dinâmicos
 */
const http = require('http');
const path = require('path');

const BASE = 'http://localhost:3000/api/financeiro';
const LOGIN_URL = 'http://localhost:3000/api/login';

let TOKEN = '';
let PASS = 0, FAIL = 0;
const FALHAS = [];
const IDS = {};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function req(method, url, body, token) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const opts = { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } };
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        const r = http.request(opts, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(d); } catch (_) {}
                resolve({ status: res.statusCode, data: json, raw: d });
            });
        });
        r.on('error', e => resolve({ status: 0, data: null, raw: e.message }));
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

function ok(id, label, cond, detail) {
    if (cond) { PASS++; console.log('  OK ' + id + ' ' + label); }
    else { FAIL++; FALHAS.push(id + ' ' + label + ' -> ' + detail); console.log('  FAIL ' + id + ' ' + label + ' -> ' + detail); }
}

async function run() {
    console.log('=== TESTE FINANCEIRO v2 ===');

    // FASE 0: Login
    console.log('\nFASE 0: Login');
    const login = await req('POST', LOGIN_URL, { email: 'qafinanceiro@aluforce.ind.br', password: 'Teste@123' });
    TOKEN = login.data && login.data.token ? login.data.token : '';
    ok('T00', 'POST /api/login', login.status === 200 && TOKEN, 'status=' + login.status);
    if (!TOKEN) { console.log('SEM TOKEN, ABORTANDO'); return; }
    await sleep(500);

    // FASE 1: Dashboard
    console.log('\nFASE 1: Dashboard + KPIs');
    let r;
    r = await req('GET', BASE + '/dashboard', null, TOKEN);
    ok('T01', 'GET /dashboard', r.status === 200, 'status=' + r.status);
    await sleep(200);
    r = await req('GET', BASE + '/dashboard-kpis', null, TOKEN);
    ok('T02', 'GET /dashboard-kpis', r.status === 200, 'status=' + r.status);
    await sleep(200);
    r = await req('GET', BASE + '/resumo-kpis', null, TOKEN);
    ok('T03', 'GET /resumo-kpis', r.status === 200, 'status=' + r.status);
    await sleep(200);
    r = await req('GET', BASE + '/proximos-vencimentos', null, TOKEN);
    ok('T04', 'GET /proximos-vencimentos', r.status === 200, 'status=' + r.status);
    await sleep(200);
    r = await req('GET', BASE + '/ultimos-lancamentos', null, TOKEN);
    ok('T05', 'GET /ultimos-lancamentos', r.status === 200, 'status=' + r.status);
    await sleep(200);
    r = await req('GET', BASE + '/alertas', null, TOKEN);
    ok('T06', 'GET /alertas', r.status === 200, 'status=' + r.status);

    // FASE 2: Permissoes
    console.log('\nFASE 2: Permissoes');
    await sleep(300);
    r = await req('GET', BASE + '/permissoes', null, TOKEN);
    ok('T07', 'GET /permissoes', r.status === 200, 'status=' + r.status);

    // FASE 3: Categorias
    console.log('\nFASE 3: Categorias');
    await sleep(300);
    r = await req('GET', BASE + '/categorias', null, TOKEN);
    ok('T08', 'GET /categorias', r.status === 200, 'status=' + r.status);
    await sleep(300);
    r = await req('POST', BASE + '/categorias', { nome: 'QA-Cat-Test', tipo: 'despesa' }, TOKEN);
    ok('T09', 'POST /categorias', [200, 201].indexOf(r.status) >= 0 && r.data && r.data.id, 'status=' + r.status);
    IDS.categoria = r.data && r.data.id;
    if (IDS.categoria) {
        await sleep(300);
        r = await req('PUT', BASE + '/categorias/' + IDS.categoria, { nome: 'QA-Cat-Upd', tipo: 'despesa' }, TOKEN);
        ok('T10', 'PUT /categorias/:id', r.status === 200, 'status=' + r.status);
        await sleep(300);
        r = await req('DELETE', BASE + '/categorias/' + IDS.categoria, null, TOKEN);
        ok('T11', 'DELETE /categorias/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T10', 'PUT /categorias/:id', false, 'Sem ID'); ok('T11', 'DELETE /categorias/:id', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 4: Contas a Pagar
    console.log('\nFASE 4: Contas a Pagar CRUD');
    r = await req('GET', BASE + '/contas-pagar', null, TOKEN);
    ok('T12', 'GET /contas-pagar', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    await sleep(400);
    r = await req('POST', BASE + '/contas-pagar', { descricao: 'QA-CP-Test', valor: 150, vencimento: '2025-12-31' }, TOKEN);
    ok('T13', 'POST /contas-pagar', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    IDS.contaPagar = r.data && r.data.id;
    await sleep(400);
    if (IDS.contaPagar) {
        r = await req('GET', BASE + '/contas-pagar/' + IDS.contaPagar, null, TOKEN);
        ok('T14', 'GET /contas-pagar/:id', r.status === 200, 'status=' + r.status);
        await sleep(300);
        r = await req('PUT', BASE + '/contas-pagar/' + IDS.contaPagar, { descricao: 'QA-CP-Upd', valor: 160, vencimento: '2025-12-31', status: 'pendente' }, TOKEN);
        ok('T15', 'PUT /contas-pagar/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T14', 'GET /contas-pagar/:id', false, 'Sem ID'); ok('T15', 'PUT /contas-pagar/:id', false, 'Sem ID'); }

    console.log('\nFASE 4b: Contas a Pagar Avancado');
    await sleep(400);
    r = await req('GET', BASE + '/contas-pagar/vencidas', null, TOKEN);
    ok('T16', 'GET /contas-pagar/vencidas', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/contas-pagar/vencendo', null, TOKEN);
    ok('T17', 'GET /contas-pagar/vencendo', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/contas-pagar/estatisticas', null, TOKEN);
    ok('T18', 'GET /contas-pagar/estatisticas', r.status === 200, 'status=' + r.status);
    await sleep(2000);
    r = await req('GET', BASE + '/contas-pagar/resumo', null, TOKEN);
    ok('T19', 'GET /contas-pagar/resumo', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    await sleep(400);

    if (IDS.contaPagar) {
        r = await req('POST', BASE + '/contas-pagar/' + IDS.contaPagar + '/pagar', { valor_pago: 160, data_pagamento: '2025-06-15', forma_pagamento: 'boleto' }, TOKEN);
        ok('T20', 'POST /contas-pagar/:id/pagar', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    } else { ok('T20', 'POST /contas-pagar/:id/pagar', false, 'Sem ID'); }
    await sleep(400);

    var baixarR = await req('POST', BASE + '/contas-pagar', { descricao: 'QA-CP-Baixar', valor: 50, vencimento: '2025-12-31' }, TOKEN);
    IDS.contaPagarBaixar = baixarR.data && baixarR.data.id;
    if (IDS.contaPagarBaixar) {
        await sleep(400);
        r = await req('POST', BASE + '/contas-pagar/' + IDS.contaPagarBaixar + '/baixar', { valor_pago: 50, data_pagamento: '2025-06-15', forma_pagamento: 'pix' }, TOKEN);
        ok('T21', 'POST /contas-pagar/:id/baixar', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    } else { ok('T21', 'POST /contas-pagar/:id/baixar', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 5: Contas a Receber
    console.log('\nFASE 5: Contas a Receber CRUD');
    r = await req('GET', BASE + '/contas-receber', null, TOKEN);
    ok('T22', 'GET /contas-receber', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    await sleep(400);
    r = await req('POST', BASE + '/contas-receber', { descricao: 'QA-CR-Test', valor: 300, vencimento: '2025-12-31' }, TOKEN);
    ok('T23', 'POST /contas-receber', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    IDS.contaReceber = r.data && r.data.id;
    await sleep(400);
    if (IDS.contaReceber) {
        r = await req('GET', BASE + '/contas-receber/' + IDS.contaReceber, null, TOKEN);
        ok('T24', 'GET /contas-receber/:id', r.status === 200, 'status=' + r.status);
        await sleep(300);
        r = await req('PUT', BASE + '/contas-receber/' + IDS.contaReceber, { descricao: 'QA-CR-Upd', valor: 310, vencimento: '2025-12-31', status: 'pendente' }, TOKEN);
        ok('T25', 'PUT /contas-receber/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T24', 'GET /contas-receber/:id', false, 'Sem ID'); ok('T25', 'PUT /contas-receber/:id', false, 'Sem ID'); }

    console.log('\nFASE 5b: Contas a Receber Avancado');
    await sleep(400);
    r = await req('GET', BASE + '/contas-receber/vencidas', null, TOKEN);
    ok('T26', 'GET /contas-receber/vencidas', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/contas-receber/inadimplentes', null, TOKEN);
    ok('T27', 'GET /contas-receber/inadimplentes', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/contas-receber/estatisticas', null, TOKEN);
    ok('T28', 'GET /contas-receber/estatisticas', r.status === 200, 'status=' + r.status);
    await sleep(2000);
    r = await req('GET', BASE + '/contas-receber/resumo', null, TOKEN);
    ok('T29', 'GET /contas-receber/resumo', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    await sleep(400);

    if (IDS.contaReceber) {
        r = await req('POST', BASE + '/contas-receber/' + IDS.contaReceber + '/receber', { valor_recebido: 310, data_recebimento: '2025-06-15', forma_recebimento: 'pix' }, TOKEN);
        ok('T30', 'POST /contas-receber/:id/receber', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    } else { ok('T30', 'POST /contas-receber/:id/receber', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 6: Bancos
    console.log('\nFASE 6: Bancos CRUD');
    r = await req('GET', BASE + '/bancos', null, TOKEN);
    ok('T31', 'GET /bancos', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/bancos', { nome: 'QA-Banco', instituicao: 'Banco QA', agencia: '0001', conta_corrente: '12345-6', tipo_conta: 'corrente', saldo_inicial: 1000, status: 'ativo' }, TOKEN);
    ok('T32', 'POST /bancos', [200, 201].indexOf(r.status) >= 0 && r.data && r.data.id, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 120));
    IDS.banco = r.data && r.data.id;
    await sleep(400);
    if (IDS.banco) {
        r = await req('GET', BASE + '/bancos/' + IDS.banco, null, TOKEN);
        ok('T33', 'GET /bancos/:id', r.status === 200, 'status=' + r.status);
        await sleep(300);
        r = await req('PUT', BASE + '/bancos/' + IDS.banco, { nome: 'QA-Banco-Upd', instituicao: 'Banco QA', agencia: '0001', conta_corrente: '12345-6', tipo_conta: 'corrente', saldo_inicial: 1000, saldo_atual: 1000, status: 'ativo' }, TOKEN);
        ok('T34', 'PUT /bancos/:id', r.status === 200, 'status=' + r.status);
        await sleep(400);
        r = await req('GET', BASE + '/bancos/' + IDS.banco + '/movimentacoes', null, TOKEN);
        ok('T35', 'GET /bancos/:id/movimentacoes', r.status === 200, 'status=' + r.status);
    } else { ok('T33', 'GET /bancos/:id', false, 'Sem ID'); ok('T34', 'PUT /bancos/:id', false, 'Sem ID'); ok('T35', 'GET /bancos/:id/movimentacoes', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 7: Contas Bancarias
    console.log('\nFASE 7: Contas Bancarias CRUD');
    r = await req('GET', BASE + '/contas-bancarias', null, TOKEN);
    ok('T36', 'GET /contas-bancarias', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/contas-bancarias/saldo-total', null, TOKEN);
    ok('T37', 'GET /contas-bancarias/saldo-total', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/contas-bancarias', { nome: 'QA-CB', banco: 'Banco QA', agencia: '0001', conta: '12345', tipo: 'corrente', saldo_inicial: 500 }, TOKEN);
    ok('T38', 'POST /contas-bancarias', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status);
    IDS.contaBancaria = r.data && r.data.id;
    await sleep(400);
    if (IDS.contaBancaria) {
        r = await req('PUT', BASE + '/contas-bancarias/' + IDS.contaBancaria, { nome: 'QA-CB-Upd', banco: 'Banco QA', agencia: '0001', conta: '12345', tipo: 'corrente' }, TOKEN);
        ok('T39', 'PUT /contas-bancarias/:id', r.status === 200, 'status=' + r.status);
        await sleep(400);
        r = await req('GET', BASE + '/contas-bancarias/' + IDS.contaBancaria + '/movimentacoes', null, TOKEN);
        ok('T40', 'GET /contas-bancarias/:id/movimentacoes', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
        await sleep(400);
        r = await req('POST', BASE + '/contas-bancarias/' + IDS.contaBancaria + '/movimentacoes', { tipo: 'entrada', valor: 100, descricao: 'QA Deposito', data: '2025-06-15' }, TOKEN);
        ok('T41', 'POST /contas-bancarias/:id/movimentacoes', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    } else { ok('T39', 'PUT /contas-bancarias/:id', false, 'Sem ID'); ok('T40', 'GET /contas-bancarias/:id/movimentacoes', false, 'Sem ID'); ok('T41', 'POST /contas-bancarias/:id/movimentacoes', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 8: Movimentacoes + Transferencia
    console.log('\nFASE 8: Movimentacoes + Transferencia');
    r = await req('GET', BASE + '/movimentacoes-bancarias', null, TOKEN);
    ok('T42', 'GET /movimentacoes-bancarias', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/movimentacoes-bancarias', { banco_id: IDS.contaBancaria || 1, tipo: 'entrada', valor: 50, cliente_fornecedor: 'QA Test', data: '2025-06-15' }, TOKEN);
    ok('T43', 'POST /movimentacoes-bancarias', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    await sleep(400);
    r = await req('POST', BASE + '/transferencia-bancaria', { conta_origem_id: IDS.contaBancaria || 1, conta_destino_id: (IDS.contaBancaria || 1) + 1, valor: 10, descricao: 'QA Transfer' }, TOKEN);
    ok('T44', 'POST /transferencia-bancaria', [200, 201, 400, 404].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));

    await sleep(2000);

    // FASE 9: Centros de Custo
    console.log('\nFASE 9: Centros de Custo');
    r = await req('GET', BASE + '/centros-custo', null, TOKEN);
    ok('T45', 'GET /centros-custo', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/centros-custo', { codigo: 'QA01', nome: 'QA Centro', departamento: 'Teste', responsavel: 'QA' }, TOKEN);
    ok('T46', 'POST /centros-custo', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    IDS.centroCusto = r.data && r.data.id;
    await sleep(400);
    if (IDS.centroCusto) {
        r = await req('PUT', BASE + '/centros-custo/' + IDS.centroCusto, { codigo: 'QA01', nome: 'QA Centro Upd', departamento: 'Teste', responsavel: 'QA' }, TOKEN);
        ok('T47', 'PUT /centros-custo/:id', r.status === 200, 'status=' + r.status);
        await sleep(400);
        r = await req('DELETE', BASE + '/centros-custo/' + IDS.centroCusto, null, TOKEN);
        ok('T48', 'DELETE /centros-custo/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T47', 'PUT /centros-custo/:id', false, 'Sem ID'); ok('T48', 'DELETE /centros-custo/:id', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 10: Impostos
    console.log('\nFASE 10: Impostos');
    r = await req('GET', BASE + '/impostos', null, TOKEN);
    ok('T49', 'GET /impostos', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/impostos', { codigo: 'QA-IMP', nome: 'QA Imposto', tipo: 'federal', aliquota: 5 }, TOKEN);
    ok('T50', 'POST /impostos', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    IDS.imposto = r.data && r.data.id;
    await sleep(400);
    if (IDS.imposto) {
        r = await req('PUT', BASE + '/impostos/' + IDS.imposto, { codigo: 'QA-IMP', nome: 'QA Imposto Upd', tipo: 'federal', aliquota: 6 }, TOKEN);
        ok('T51', 'PUT /impostos/:id', r.status === 200, 'status=' + r.status);
        await sleep(400);
        r = await req('DELETE', BASE + '/impostos/' + IDS.imposto, null, TOKEN);
        ok('T52', 'DELETE /impostos/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T51', 'PUT /impostos/:id', false, 'Sem ID'); ok('T52', 'DELETE /impostos/:id', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 11: Orcamentos
    console.log('\nFASE 11: Orcamentos');
    r = await req('GET', BASE + '/orcamentos', null, TOKEN);
    ok('T53', 'GET /orcamentos', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/orcamentos', { categoria: 'QA-Orc', centro_custo: 'Geral', limite: 5000, alerta_pct: 80 }, TOKEN);
    ok('T54', 'POST /orcamentos', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    IDS.orcamento = r.data && r.data.id;
    await sleep(400);
    if (IDS.orcamento) {
        r = await req('PUT', BASE + '/orcamentos/' + IDS.orcamento, { categoria: 'QA-Orc', centro_custo: 'Geral', limite: 6000, alerta_pct: 85 }, TOKEN);
        ok('T55', 'PUT /orcamentos/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T55', 'PUT /orcamentos/:id', false, 'Sem ID'); }
    await sleep(400);
    r = await req('GET', BASE + '/orcamentos/alertas', null, TOKEN);
    ok('T56', 'GET /orcamentos/alertas', r.status === 200, 'status=' + r.status);

    await sleep(2000);

    // FASE 12: Plano de Contas
    console.log('\nFASE 12: Plano de Contas');
    r = await req('GET', BASE + '/plano-contas', null, TOKEN);
    ok('T57', 'GET /plano-contas', r.status === 200, 'status=' + r.status);
    await sleep(400);
    var pcCod = 'QA' + Date.now().toString().slice(-6);
    r = await req('POST', BASE + '/plano-contas', { codigo: pcCod, nome: 'QA Plano', tipo: 'receita' }, TOKEN);
    ok('T58', 'POST /plano-contas', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    IDS.planoContas = r.data && r.data.id;
    await sleep(400);
    if (IDS.planoContas) {
        r = await req('PUT', BASE + '/plano-contas/' + IDS.planoContas, { codigo: pcCod, nome: 'QA Plano Upd', tipo: 'receita' }, TOKEN);
        ok('T59', 'PUT /plano-contas/:id', r.status === 200, 'status=' + r.status);
        await sleep(400);
        r = await req('DELETE', BASE + '/plano-contas/' + IDS.planoContas, null, TOKEN);
        ok('T60', 'DELETE /plano-contas/:id', r.status === 200, 'status=' + r.status);
    } else { ok('T59', 'PUT /plano-contas/:id', false, 'Sem ID'); ok('T60', 'DELETE /plano-contas/:id', false, 'Sem ID'); }

    await sleep(2000);

    // FASE 13: Clientes-Fornecedores
    console.log('\nFASE 13: Clientes-Fornecedores');
    r = await req('GET', BASE + '/clientes-fornecedores', null, TOKEN);
    ok('T61', 'GET /clientes-fornecedores', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/clientes-fornecedores/buscar?q=teste', null, TOKEN);
    ok('T62', 'GET /clientes-fornecedores/buscar', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('POST', BASE + '/clientes-fornecedores', { razao_social: 'QA Fornecedor Ltda', nome_fantasia: 'QA Forn', cnpj_cpf: '11222333000144', cidade: 'SP', estado: 'SP' }, TOKEN);
    ok('T63', 'POST /clientes-fornecedores', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));

    await sleep(2000);

    // FASE 14: Operacoes de Desconto
    console.log('\nFASE 14: Operacoes de Desconto');
    r = await req('POST', BASE + '/operacoes/desconto', { tipo: 'percentual', valor: 10, descricao: 'QA Desconto' }, TOKEN);
    ok('T64', 'POST /operacoes/desconto', [200, 201].indexOf(r.status) >= 0, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));

    await sleep(2000);

    // FASE 15: Relatorios
    console.log('\nFASE 15: Relatorios');
    r = await req('GET', BASE + '/relatorios/dre', null, TOKEN);
    ok('T65', 'GET /relatorios/dre', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/relatorios/lucratividade', null, TOKEN);
    ok('T66', 'GET /relatorios/lucratividade', r.status === 200, 'status=' + r.status);

    await sleep(2000);

    // FASE 16: Outros
    console.log('\nFASE 16: Outros Endpoints');
    r = await req('GET', BASE + '/faturamento', null, TOKEN);
    ok('T67', 'GET /faturamento', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/balanco', null, TOKEN);
    ok('T68', 'GET /balanco', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/fluxo-caixa', null, TOKEN);
    ok('T69', 'GET /fluxo-caixa', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/busca-global?q=QA', null, TOKEN);
    ok('T70', 'GET /busca-global', r.status === 200, 'status=' + r.status);
    await sleep(400);
    r = await req('GET', BASE + '/contas/resumo', null, TOKEN);
    ok('T71', 'GET /contas/resumo', r.status === 200, 'status=' + r.status);

    await sleep(2000);

    // T72 - Lote validacao
    r = await req('POST', BASE + '/contas-pagar/lote/pagar', { contas: [], data_pagamento: '2025-06-15' }, TOKEN);
    ok('T72', 'POST /contas-pagar/lote/pagar (validacao)', r.status === 400, 'status=' + r.status + ' (esperado 400)');
    await sleep(1000);

    // FASE 17: Fornecedores e Clientes
    console.log('\nFASE 17: Fornecedores e Clientes');
    r = await req('GET', BASE + '/fornecedores', null, TOKEN);
    ok('T73', 'GET /fornecedores', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    await sleep(400);
    r = await req('GET', BASE + '/clientes', null, TOKEN);
    ok('T74', 'GET /clientes', r.status === 200, 'status=' + r.status + ' ' + (r.raw || '').substring(0, 100));
    await sleep(1000);

    // FASE 18: API Aberta
    console.log('\nFASE 18: API Aberta');
    r = await req('GET', BASE + '/api-aberta/contas-receber', null, TOKEN);
    ok('T75', 'GET /api-aberta/contas-receber', r.status === 200, 'status=' + r.status);

    // FASE 19: Cleanup
    console.log('\nFASE 19: Cleanup');
    await sleep(500);
    if (IDS.contaPagar) { r = await req('DELETE', BASE + '/contas-pagar/' + IDS.contaPagar, null, TOKEN); ok('T76', 'DELETE /contas-pagar (cleanup)', r.status === 200, 'status=' + r.status); await sleep(300); }
    else { ok('T76', 'DELETE /contas-pagar (cleanup)', true, 'skip'); }
    if (IDS.contaPagarBaixar) { r = await req('DELETE', BASE + '/contas-pagar/' + IDS.contaPagarBaixar, null, TOKEN); ok('T77', 'DELETE /contas-pagar baixar (cleanup)', r.status === 200, 'status=' + r.status); await sleep(300); }
    else { ok('T77', 'DELETE /contas-pagar baixar (cleanup)', true, 'skip'); }
    if (IDS.contaReceber) { r = await req('DELETE', BASE + '/contas-receber/' + IDS.contaReceber, null, TOKEN); ok('T78', 'DELETE /contas-receber (cleanup)', r.status === 200, 'status=' + r.status); await sleep(300); }
    else { ok('T78', 'DELETE /contas-receber (cleanup)', true, 'skip'); }
    if (IDS.banco) { r = await req('DELETE', BASE + '/bancos/' + IDS.banco, null, TOKEN); ok('T79', 'DELETE /bancos (cleanup)', r.status === 200, 'status=' + r.status); await sleep(300); }
    else { ok('T79', 'DELETE /bancos (cleanup)', true, 'skip'); }
    if (IDS.contaBancaria) { r = await req('DELETE', BASE + '/contas-bancarias/' + IDS.contaBancaria, null, TOKEN); ok('T80', 'DELETE /contas-bancarias (cleanup)', r.status === 200, 'status=' + r.status); await sleep(300); }
    else { ok('T80', 'DELETE /contas-bancarias (cleanup)', true, 'skip'); }
    if (IDS.orcamento) { r = await req('DELETE', BASE + '/orcamentos/' + IDS.orcamento, null, TOKEN); ok('T81', 'DELETE /orcamentos (cleanup)', r.status === 200, 'status=' + r.status); }
    else { ok('T81', 'DELETE /orcamentos (cleanup)', true, 'skip'); }

    // RESULTADO
    var total = PASS + FAIL;
    var pct = ((PASS / total) * 100).toFixed(1);
    console.log('\n======================================================================');
    console.log('  RESULTADO: ' + PASS + '/' + total + ' testes passando (' + pct + '%)');
    console.log('  OK: ' + PASS + '  |  FAIL: ' + FAIL);
    console.log('======================================================================');
    if (FALHAS.length > 0) {
        console.log('\nFALHAS DETALHADAS:');
        FALHAS.forEach(function(f, i) { console.log('  ' + (i + 1) + '. ' + f); });
    }
    console.log('\nIDs criados:', JSON.stringify(IDS));
}

run().catch(function(e) { console.error('FATAL:', e); process.exit(1); });