/**
 * TEST SUITE — Módulo Financeiro (ALUFORCE v2.1.7)
 * Testa todas as rotas API + verifica HTML frontend
 * Uso: node test-financeiro-v1.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const LOGIN_EMAIL = 'qafinanceiro@aluforce.ind.br';
const LOGIN_PASS = 'Teste@123';

let TOKEN = '';
let totalTests = 0, pass = 0, fail = 0;
const failures = [];
const createdIds = {};

function req(method, urlPath, body = null) {
    return new Promise((resolve) => {
        const url = new URL(urlPath, BASE);
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `authToken=${TOKEN}`,
                'Authorization': `Bearer ${TOKEN}`
            },
            timeout: 15000
        };
        const r = http.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch (_) {}
                resolve({ status: res.statusCode, data: json, raw: data, headers: res.headers });
            });
        });
        r.on('error', (e) => resolve({ status: 0, data: null, raw: e.message, headers: {} }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, data: null, raw: 'TIMEOUT', headers: {} }); });
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

function test(name, ok, detail = '') {
    totalTests++;
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; const msg = `${name}${detail ? ' → ' + detail : ''}`; failures.push(msg); console.log(`  ❌ ${name}${detail ? ' → ' + detail : ''}`); }
}

async function run() {
    console.log('='.repeat(70));
    console.log('  TESTE COMPLETO — MÓDULO FINANCEIRO');
    console.log('='.repeat(70));

    // ============================================================
    // FASE 0: LOGIN
    // ============================================================
    console.log('\n📋 FASE 0: Login');
    const login = await req('POST', '/api/login', { email: LOGIN_EMAIL, password: LOGIN_PASS });
    TOKEN = login.data?.token || '';
    test('T00 POST /api/login', login.status === 200 && !!TOKEN, `status=${login.status}`);
    if (!TOKEN) { console.log('FATAL: Sem token. Abortando.'); process.exit(1); }

    // ============================================================
    // FASE 1: DASHBOARD + KPIs
    // ============================================================
    console.log('\n📋 FASE 1: Dashboard + KPIs');

    const dash = await req('GET', '/api/financeiro/dashboard');
    test('T01 GET /dashboard', dash.status === 200 && dash.data?.success, `status=${dash.status} ${dash.raw?.substring(0,120)}`);

    const kpis = await req('GET', '/api/financeiro/dashboard-kpis');
    test('T02 GET /dashboard-kpis', kpis.status === 200 && kpis.data?.success, `status=${kpis.status}`);

    const resumoKpis = await req('GET', '/api/financeiro/resumo-kpis');
    test('T03 GET /resumo-kpis', resumoKpis.status === 200 && resumoKpis.data?.success, `status=${resumoKpis.status}`);

    const proxVenc = await req('GET', '/api/financeiro/proximos-vencimentos');
    test('T04 GET /proximos-vencimentos', proxVenc.status === 200 && proxVenc.data?.success, `status=${proxVenc.status}`);

    const ultLanc = await req('GET', '/api/financeiro/ultimos-lancamentos');
    test('T05 GET /ultimos-lancamentos', ultLanc.status === 200 && ultLanc.data?.success, `status=${ultLanc.status}`);

    const alertas = await req('GET', '/api/financeiro/alertas');
    test('T06 GET /alertas', alertas.status === 200 && alertas.data?.success, `status=${alertas.status}`);

    // ============================================================
    // FASE 2: PERMISSÕES
    // ============================================================
    console.log('\n📋 FASE 2: Permissões');
    const perms = await req('GET', '/api/financeiro/permissoes');
    test('T07 GET /permissoes', perms.status === 200 && perms.data?.success, `status=${perms.status}`);

    // ============================================================
    // FASE 3: CATEGORIAS FINANCEIRAS (core.js)
    // ============================================================
    console.log('\n📋 FASE 3: Categorias Financeiras');

    const catList = await req('GET', '/api/financeiro/categorias');
    test('T08 GET /categorias', catList.status === 200 && Array.isArray(catList.data), `status=${catList.status}`);

    const catCreate = await req('POST', '/api/financeiro/categorias', { nome: 'QA-Teste-Cat', tipo: 'despesa', cor: '#ff0000' });
    test('T09 POST /categorias', catCreate.status === 201 && catCreate.data?.success, `status=${catCreate.status} ${catCreate.raw?.substring(0,120)}`);
    createdIds.categoria = catCreate.data?.id;

    if (createdIds.categoria) {
        const catUpdate = await req('PUT', `/api/financeiro/categorias/${createdIds.categoria}`, { nome: 'QA-Teste-Cat-Upd', tipo: 'receita', cor: '#00ff00', icone: 'fas fa-tag', orcamento_mensal: 100, descricao: 'test', ativo: 1 });
        test('T10 PUT /categorias/:id', catUpdate.status === 200 && catUpdate.data?.success, `status=${catUpdate.status}`);

        const catDel = await req('DELETE', `/api/financeiro/categorias/${createdIds.categoria}`);
        test('T11 DELETE /categorias/:id', catDel.status === 200 && catDel.data?.success, `status=${catDel.status}`);
    } else {
        test('T10 PUT /categorias/:id', false, 'Sem ID da criação');
        test('T11 DELETE /categorias/:id', false, 'Sem ID da criação');
    }

    // ============================================================
    // FASE 4: CONTAS A PAGAR — CRUD (core.js)
    // ============================================================
    console.log('\n📋 FASE 4: Contas a Pagar — CRUD');

    const cpList = await req('GET', '/api/financeiro/contas-pagar');
    test('T12 GET /contas-pagar', cpList.status === 200 && (cpList.data?.success || Array.isArray(cpList.data?.data)), `status=${cpList.status} ${cpList.raw?.substring(0,120)}`);

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const cpCreate = await req('POST', '/api/financeiro/contas-pagar', {
        descricao: 'QA-Teste-CP', valor: 150.50, vencimento: tomorrow, data_vencimento: tomorrow, observacoes: 'Teste automatizado'
    });
    test('T13 POST /contas-pagar', cpCreate.status === 201 && cpCreate.data?.success, `status=${cpCreate.status} ${cpCreate.raw?.substring(0,200)}`);
    createdIds.contaPagar = cpCreate.data?.id;

    if (createdIds.contaPagar) {
        const cpGet = await req('GET', `/api/financeiro/contas-pagar/${createdIds.contaPagar}`);
        test('T14 GET /contas-pagar/:id', cpGet.status === 200, `status=${cpGet.status}`);

        const cpUpdate = await req('PUT', `/api/financeiro/contas-pagar/${createdIds.contaPagar}`, {
            descricao: 'QA-Teste-CP-Upd', valor: 200, vencimento: tomorrow, status: 'pendente'
        });
        test('T15 PUT /contas-pagar/:id', cpUpdate.status === 200 && cpUpdate.data?.success, `status=${cpUpdate.status}`);
    } else {
        test('T14 GET /contas-pagar/:id', false, 'Sem ID');
        test('T15 PUT /contas-pagar/:id', false, 'Sem ID');
    }

    // Contas a Pagar — Avançado
    console.log('\n📋 FASE 4b: Contas a Pagar — Avançado');
    const cpVencidas = await req('GET', '/api/financeiro/contas-pagar/vencidas');
    test('T16 GET /contas-pagar/vencidas', cpVencidas.status === 200, `status=${cpVencidas.status}`);

    const cpVencendo = await req('GET', '/api/financeiro/contas-pagar/vencendo?dias=30');
    test('T17 GET /contas-pagar/vencendo', cpVencendo.status === 200, `status=${cpVencendo.status}`);

    const cpStats = await req('GET', '/api/financeiro/contas-pagar/estatisticas');
    test('T18 GET /contas-pagar/estatisticas', cpStats.status === 200, `status=${cpStats.status}`);

    const cpResumo = await req('GET', '/api/financeiro/contas-pagar/resumo');
    test('T19 GET /contas-pagar/resumo', cpResumo.status === 200, `status=${cpResumo.status}`);

    // Pagar conta (core.js /pagar)
    if (createdIds.contaPagar) {
        const cpPagar = await req('POST', `/api/financeiro/contas-pagar/${createdIds.contaPagar}/pagar`, {
            valor_pago: 200, data_pagamento: tomorrow
        });
        test('T20 POST /contas-pagar/:id/pagar', cpPagar.status === 200 && cpPagar.data?.success, `status=${cpPagar.status} ${cpPagar.raw?.substring(0,200)}`);
    } else {
        test('T20 POST /contas-pagar/:id/pagar', false, 'Sem ID');
    }

    // Baixar conta (extended.js /baixar)
    if (createdIds.contaPagar) {
        const cpBaixar = await req('POST', `/api/financeiro/contas-pagar/${createdIds.contaPagar}/baixar`, {
            valor_pago: 200, data_pagamento: tomorrow
        });
        test('T21 POST /contas-pagar/:id/baixar', cpBaixar.status === 200 && cpBaixar.data?.success, `status=${cpBaixar.status} ${cpBaixar.raw?.substring(0,200)}`);
    } else {
        test('T21 POST /contas-pagar/:id/baixar', false, 'Sem ID');
    }

    // Cleanup
    if (createdIds.contaPagar) {
        await req('DELETE', `/api/financeiro/contas-pagar/${createdIds.contaPagar}`);
    }

    // ============================================================
    // FASE 5: CONTAS A RECEBER — CRUD (core.js)
    // ============================================================
    console.log('\n📋 FASE 5: Contas a Receber — CRUD');

    const crList = await req('GET', '/api/financeiro/contas-receber');
    test('T22 GET /contas-receber', crList.status === 200 && (crList.data?.success || Array.isArray(crList.data?.data)), `status=${crList.status} ${crList.raw?.substring(0,120)}`);

    const crCreate = await req('POST', '/api/financeiro/contas-receber', {
        descricao: 'QA-Teste-CR', valor: 300.75, vencimento: tomorrow, data_vencimento: tomorrow, observacoes: 'Teste automatizado'
    });
    test('T23 POST /contas-receber', crCreate.status === 201 && crCreate.data?.success, `status=${crCreate.status} ${crCreate.raw?.substring(0,200)}`);
    createdIds.contaReceber = crCreate.data?.id;

    if (createdIds.contaReceber) {
        const crGet = await req('GET', `/api/financeiro/contas-receber/${createdIds.contaReceber}`);
        test('T24 GET /contas-receber/:id', crGet.status === 200, `status=${crGet.status}`);

        const crUpdate = await req('PUT', `/api/financeiro/contas-receber/${createdIds.contaReceber}`, {
            descricao: 'QA-Teste-CR-Upd', valor: 400, vencimento: tomorrow, status: 'pendente'
        });
        test('T25 PUT /contas-receber/:id', crUpdate.status === 200 && crUpdate.data?.success, `status=${crUpdate.status}`);
    } else {
        test('T24 GET /contas-receber/:id', false, 'Sem ID');
        test('T25 PUT /contas-receber/:id', false, 'Sem ID');
    }

    // Contas a Receber — Avançado
    console.log('\n📋 FASE 5b: Contas a Receber — Avançado');
    const crVencidas = await req('GET', '/api/financeiro/contas-receber/vencidas');
    test('T26 GET /contas-receber/vencidas', crVencidas.status === 200, `status=${crVencidas.status}`);

    const crInad = await req('GET', '/api/financeiro/contas-receber/inadimplentes');
    test('T27 GET /contas-receber/inadimplentes', crInad.status === 200, `status=${crInad.status}`);

    const crStats = await req('GET', '/api/financeiro/contas-receber/estatisticas');
    test('T28 GET /contas-receber/estatisticas', crStats.status === 200, `status=${crStats.status}`);

    const crResumo = await req('GET', '/api/financeiro/contas-receber/resumo');
    test('T29 GET /contas-receber/resumo', crResumo.status === 200, `status=${crResumo.status}`);

    // Receber conta (core.js /receber)
    if (createdIds.contaReceber) {
        const crReceber = await req('POST', `/api/financeiro/contas-receber/${createdIds.contaReceber}/receber`, {
            valor_recebido: 400, data_recebimento: tomorrow
        });
        test('T30 POST /contas-receber/:id/receber', crReceber.status === 200 && crReceber.data?.success, `status=${crReceber.status} ${crReceber.raw?.substring(0,200)}`);
    } else {
        test('T30 POST /contas-receber/:id/receber', false, 'Sem ID');
    }

    // Cleanup
    if (createdIds.contaReceber) {
        await req('DELETE', `/api/financeiro/contas-receber/${createdIds.contaReceber}`);
    }

    // ============================================================
    // FASE 6: BANCOS — CRUD (extended.js, tabela `bancos`)
    // ============================================================
    console.log('\n📋 FASE 6: Bancos — CRUD');

    const bancoList = await req('GET', '/api/financeiro/bancos');
    test('T31 GET /bancos', bancoList.status === 200 && Array.isArray(bancoList.data), `status=${bancoList.status} type=${typeof bancoList.data}`);

    const bancoCreate = await req('POST', '/api/financeiro/bancos', {
        nome: 'QA-Banco-Test', agencia: '0001', conta: '12345-6', tipo: 'corrente', saldo_inicial: 1000
    });
    test('T32 POST /bancos', bancoCreate.status === 200 && bancoCreate.data?.success, `status=${bancoCreate.status} ${bancoCreate.raw?.substring(0,200)}`);
    createdIds.banco = bancoCreate.data?.id;

    if (createdIds.banco) {
        const bancoGet = await req('GET', `/api/financeiro/bancos/${createdIds.banco}`);
        test('T33 GET /bancos/:id', bancoGet.status === 200, `status=${bancoGet.status}`);

        const bancoUpdate = await req('PUT', `/api/financeiro/bancos/${createdIds.banco}`, {
            nome: 'QA-Banco-Upd', agencia: '0002', conta: '99999-0', tipo: 'corrente', saldo: 2000
        });
        test('T34 PUT /bancos/:id', bancoUpdate.status === 200 && bancoUpdate.data?.success, `status=${bancoUpdate.status} ${bancoUpdate.raw?.substring(0,200)}`);

        // Movimentações do banco
        const bancoMov = await req('GET', `/api/financeiro/bancos/${createdIds.banco}/movimentacoes`);
        test('T35 GET /bancos/:id/movimentacoes', bancoMov.status === 200, `status=${bancoMov.status}`);

        // Cleanup
        await req('DELETE', `/api/financeiro/bancos/${createdIds.banco}`);
    } else {
        test('T33 GET /bancos/:id', false, 'Sem ID');
        test('T34 PUT /bancos/:id', false, 'Sem ID');
        test('T35 GET /bancos/:id/movimentacoes', false, 'Sem ID');
    }

    // ============================================================
    // FASE 7: CONTAS BANCÁRIAS — CRUD (extended.js, tabela `contas_bancarias`)
    // ============================================================
    console.log('\n📋 FASE 7: Contas Bancárias — CRUD');

    const cbList = await req('GET', '/api/financeiro/contas-bancarias');
    test('T36 GET /contas-bancarias', cbList.status === 200 && Array.isArray(cbList.data), `status=${cbList.status}`);

    const cbSaldo = await req('GET', '/api/financeiro/contas-bancarias/saldo-total');
    test('T37 GET /contas-bancarias/saldo-total', cbSaldo.status === 200 && cbSaldo.data?.saldo_total !== undefined, `status=${cbSaldo.status}`);

    const cbCreate = await req('POST', '/api/financeiro/contas-bancarias', {
        nome: 'QA-ContaBanc-Test', banco: 'Bradesco', tipo: 'corrente', agencia: '0001', numero_conta: '12345', saldo: 500
    });
    test('T38 POST /contas-bancarias', cbCreate.status === 200 && cbCreate.data?.success, `status=${cbCreate.status} ${cbCreate.raw?.substring(0,200)}`);
    createdIds.contaBancaria = cbCreate.data?.id;

    if (createdIds.contaBancaria) {
        const cbUpdate = await req('PUT', `/api/financeiro/contas-bancarias/${createdIds.contaBancaria}`, {
            nome: 'QA-ContaBanc-Upd', banco: 'Itaú', tipo: 'corrente', agencia: '0002', numero_conta: '99999', saldo: 1000
        });
        test('T39 PUT /contas-bancarias/:id', cbUpdate.status === 200 && cbUpdate.data?.success, `status=${cbUpdate.status}`);

        // Movimentações da conta bancária
        const cbMov = await req('GET', `/api/financeiro/contas-bancarias/${createdIds.contaBancaria}/movimentacoes`);
        test('T40 GET /contas-bancarias/:id/movimentacoes', cbMov.status === 200, `status=${cbMov.status} ${cbMov.raw?.substring(0,200)}`);

        // Criar movimentação na conta bancária
        const cbMovCreate = await req('POST', `/api/financeiro/contas-bancarias/${createdIds.contaBancaria}/movimentacoes`, {
            tipo: 'entrada', valor: 100, descricao: 'QA-Mov-Test', data: tomorrow
        });
        test('T41 POST /contas-bancarias/:id/movimentacoes', cbMovCreate.status === 200 && cbMovCreate.data?.success, `status=${cbMovCreate.status} ${cbMovCreate.raw?.substring(0,200)}`);

        // Cleanup
        await req('DELETE', `/api/financeiro/contas-bancarias/${createdIds.contaBancaria}`);
    } else {
        test('T39 PUT /contas-bancarias/:id', false, 'Sem ID');
        test('T40 GET /contas-bancarias/:id/movimentacoes', false, 'Sem ID');
        test('T41 POST /contas-bancarias/:id/movimentacoes', false, 'Sem ID');
    }

    // ============================================================
    // FASE 8: MOVIMENTAÇÕES BANCÁRIAS + TRANSFERÊNCIA
    // ============================================================
    console.log('\n📋 FASE 8: Movimentações + Transferência');

    const movList = await req('GET', '/api/financeiro/movimentacoes-bancarias');
    test('T42 GET /movimentacoes-bancarias', movList.status === 200, `status=${movList.status}`);

    // Criar movimentação (precisa de banco_id real)
    // Buscar primeiro banco existente
    const bankForMov = bancoList.data?.[0]?.id || null;
    if (bankForMov) {
        const movCreate = await req('POST', '/api/financeiro/movimentacoes-bancarias', {
            banco_id: bankForMov, tipo: 'entrada', valor: 50.00, data: tomorrow, descricao: 'QA-Mov-Test', categoria: 'teste'
        });
        test('T43 POST /movimentacoes-bancarias', movCreate.status === 200 && movCreate.data?.success, `status=${movCreate.status} ${movCreate.raw?.substring(0,200)}`);
    } else {
        test('T43 POST /movimentacoes-bancarias', false, 'Nenhum banco para movimentação');
    }

    // Transferência bancária (precisa de 2 contas bancárias)
    const cb1 = cbList.data?.[0]?.id;
    const cb2 = cbList.data?.[1]?.id;
    if (cb1 && cb2) {
        const transf = await req('POST', '/api/financeiro/transferencia-bancaria', {
            conta_origem: cb1, conta_destino: cb2, valor: 10.00, data: tomorrow, descricao: 'QA-Transf-Test'
        });
        test('T44 POST /transferencia-bancaria', transf.status === 200 && transf.data?.success, `status=${transf.status} ${transf.raw?.substring(0,200)}`);
    } else {
        test('T44 POST /transferencia-bancaria', false, 'Precisa 2+ contas bancárias');
    }

    // ============================================================
    // FASE 9: CENTROS DE CUSTO
    // ============================================================
    console.log('\n📋 FASE 9: Centros de Custo');

    const ccList = await req('GET', '/api/financeiro/centros-custo');
    test('T45 GET /centros-custo', ccList.status === 200 && ccList.data?.data, `status=${ccList.status}`);

    const ccCreate = await req('POST', '/api/financeiro/centros-custo', {
        codigo: 'QA001', nome: 'QA-Centro-Test', departamento: 'TI', responsavel: 'QA', orcamento_mensal: 5000
    });
    test('T46 POST /centros-custo', ccCreate.status === 201 && ccCreate.data?.success, `status=${ccCreate.status} ${ccCreate.raw?.substring(0,200)}`);
    createdIds.centroCusto = ccCreate.data?.id;

    if (createdIds.centroCusto) {
        const ccUpdate = await req('PUT', `/api/financeiro/centros-custo/${createdIds.centroCusto}`, {
            codigo: 'QA002', nome: 'QA-Centro-Upd', departamento: 'RH', orcamento_mensal: 8000, ativo: 1
        });
        test('T47 PUT /centros-custo/:id', ccUpdate.status === 200 && ccUpdate.data?.success, `status=${ccUpdate.status}`);

        const ccDel = await req('DELETE', `/api/financeiro/centros-custo/${createdIds.centroCusto}`);
        test('T48 DELETE /centros-custo/:id', ccDel.status === 200 && ccDel.data?.success, `status=${ccDel.status}`);
    } else {
        test('T47 PUT /centros-custo/:id', false, 'Sem ID');
        test('T48 DELETE /centros-custo/:id', false, 'Sem ID');
    }

    // ============================================================
    // FASE 10: IMPOSTOS
    // ============================================================
    console.log('\n📋 FASE 10: Impostos');

    const impList = await req('GET', '/api/financeiro/impostos');
    test('T49 GET /impostos', impList.status === 200 && impList.data?.data, `status=${impList.status}`);

    const impCreate = await req('POST', '/api/financeiro/impostos', {
        codigo: 'QA-IMP', nome: 'QA-Imposto-Test', tipo: 'federal', aliquota: 5.00, base: 'faturamento', descricao: 'Teste'
    });
    test('T50 POST /impostos', impCreate.status === 200 && impCreate.data?.success, `status=${impCreate.status} ${impCreate.raw?.substring(0,200)}`);
    createdIds.imposto = impCreate.data?.id;

    if (createdIds.imposto) {
        const impUpdate = await req('PUT', `/api/financeiro/impostos/${createdIds.imposto}`, {
            codigo: 'QA-IMP2', nome: 'QA-Imposto-Upd', tipo: 'estadual', aliquota: 18.00, base: 'nota_fiscal', descricao: 'Upd'
        });
        test('T51 PUT /impostos/:id', impUpdate.status === 200 && impUpdate.data?.success, `status=${impUpdate.status}`);

        const impDel = await req('DELETE', `/api/financeiro/impostos/${createdIds.imposto}`);
        test('T52 DELETE /impostos/:id', impDel.status === 200 && impDel.data?.success, `status=${impDel.status}`);
    } else {
        test('T51 PUT /impostos/:id', false, 'Sem ID');
        test('T52 DELETE /impostos/:id', false, 'Sem ID');
    }

    // ============================================================
    // FASE 11: ORÇAMENTOS
    // ============================================================
    console.log('\n📋 FASE 11: Orçamentos');

    const orcList = await req('GET', '/api/financeiro/orcamentos');
    test('T53 GET /orcamentos', orcList.status === 200 && Array.isArray(orcList.data), `status=${orcList.status} type=${typeof orcList.data}`);

    const orcCreate = await req('POST', '/api/financeiro/orcamentos', {
        categoria: 'QA-Orc-Test', centro_custo: 'TI', limite: 10000, alerta: 'alto', alerta_pct: 80
    });
    test('T54 POST /orcamentos', orcCreate.status === 201 && orcCreate.data?.success, `status=${orcCreate.status} ${orcCreate.raw?.substring(0,200)}`);
    createdIds.orcamento = orcCreate.data?.id;

    if (createdIds.orcamento) {
        const orcUpdate = await req('PUT', `/api/financeiro/orcamentos/${createdIds.orcamento}`, {
            categoria: 'QA-Orc-Upd', centro_custo: 'RH', limite: 20000, alerta_pct: 90
        });
        test('T55 PUT /orcamentos/:id', orcUpdate.status === 200 && orcUpdate.data?.success, `status=${orcUpdate.status}`);
    } else {
        test('T55 PUT /orcamentos/:id', false, 'Sem ID');
    }

    const orcAlertas = await req('GET', '/api/financeiro/orcamentos/alertas');
    test('T56 GET /orcamentos/alertas', orcAlertas.status === 200, `status=${orcAlertas.status}`);

    // Cleanup orçamento
    if (createdIds.orcamento) {
        await req('DELETE', `/api/financeiro/orcamentos/${createdIds.orcamento}`).catch(() => {});
    }

    // ============================================================
    // FASE 12: PLANO DE CONTAS
    // ============================================================
    console.log('\n📋 FASE 12: Plano de Contas');

    const pcList = await req('GET', '/api/financeiro/plano-contas');
    test('T57 GET /plano-contas', pcList.status === 200 && Array.isArray(pcList.data), `status=${pcList.status}`);

    const pcCreate = await req('POST', '/api/financeiro/plano-contas', {
        codigo: 'QA.1.0.0', nome: 'QA-PlanoContas-Test', tipo: 'receita', cor: '#6366f1'
    });
    test('T58 POST /plano-contas', pcCreate.status === 200 && pcCreate.data?.success, `status=${pcCreate.status} ${pcCreate.raw?.substring(0,200)}`);
    createdIds.planoConta = pcCreate.data?.id;

    if (createdIds.planoConta) {
        const pcUpdate = await req('PUT', `/api/financeiro/plano-contas/${createdIds.planoConta}`, {
            codigo: 'QA.2.0.0', nome: 'QA-PlanoContas-Upd', tipo: 'despesa', cor: '#ff0000'
        });
        test('T59 PUT /plano-contas/:id', pcUpdate.status === 200 && pcUpdate.data?.success, `status=${pcUpdate.status}`);

        const pcDel = await req('DELETE', `/api/financeiro/plano-contas/${createdIds.planoConta}`);
        test('T60 DELETE /plano-contas/:id', pcDel.status === 200 && pcDel.data?.success, `status=${pcDel.status}`);
    } else {
        test('T59 PUT /plano-contas/:id', false, 'Sem ID');
        test('T60 DELETE /plano-contas/:id', false, 'Sem ID');
    }

    // ============================================================
    // FASE 13: CLIENTES-FORNECEDORES
    // ============================================================
    console.log('\n📋 FASE 13: Clientes-Fornecedores');

    const cfList = await req('GET', '/api/financeiro/clientes-fornecedores');
    test('T61 GET /clientes-fornecedores', cfList.status === 200 && cfList.data?.data, `status=${cfList.status}`);

    const cfBusca = await req('GET', '/api/financeiro/clientes-fornecedores/buscar?termo=teste');
    test('T62 GET /clientes-fornecedores/buscar', cfBusca.status === 200
        && cfBusca.data?.data !== undefined, `status=${cfBusca.status}`);

    const cfCreate = await req('POST', '/api/financeiro/clientes-fornecedores', {
        razao_social: 'QA Empresa Test Ltda', nome_fantasia: 'QA Test', cnpj_cpf: '12345678000199',
        telefone: '11999999999', cidade: 'São Paulo', estado: 'SP'
    });
    test('T63 POST /clientes-fornecedores', cfCreate.status === 200 && cfCreate.data?.success, `status=${cfCreate.status} ${cfCreate.raw?.substring(0,200)}`);

    // ============================================================
    // FASE 14: OPERAÇÕES DE DESCONTO
    // ============================================================
    console.log('\n📋 FASE 14: Operações de Desconto');

    const desconto = await req('POST', '/api/financeiro/operacoes/desconto', {
        numero_titulo: 'QA-DESC-001', cliente_sacado: 'QA Test', valor_titulo: 5000,
        data_vencimento: tomorrow, banco: 'Bradesco', taxa_desconto: 2.5, iof: 0.38,
        valor_liquido: 4856
    });
    test('T64 POST /operacoes/desconto', desconto.status === 200 && desconto.data?.success, `status=${desconto.status} ${desconto.raw?.substring(0,200)}`);

    // ============================================================
    // FASE 15: RELATÓRIOS
    // ============================================================
    console.log('\n📋 FASE 15: Relatórios');

    const dre = await req('GET', '/api/financeiro/relatorios/dre?ano=2025');
    test('T65 GET /relatorios/dre', dre.status === 200 && dre.data?.success, `status=${dre.status}`);

    const lucro = await req('GET', '/api/financeiro/relatorios/lucratividade');
    test('T66 GET /relatorios/lucratividade', lucro.status === 200, `status=${lucro.status} ${lucro.raw?.substring(0,120)}`);

    // ============================================================
    // FASE 16: OUTROS ENDPOINTS
    // ============================================================
    console.log('\n📋 FASE 16: Outros Endpoints');

    const fatur = await req('GET', '/api/financeiro/faturamento');
    test('T67 GET /faturamento', fatur.status === 200, `status=${fatur.status}`);

    const bal = await req('GET', '/api/financeiro/balanco');
    test('T68 GET /balanco', bal.status === 200, `status=${bal.status}`);

    const fluxo = await req('GET', '/api/financeiro/fluxo-caixa');
    test('T69 GET /fluxo-caixa', fluxo.status === 200, `status=${fluxo.status}`);

    const buscaGlobal = await req('GET', '/api/financeiro/busca-global?q=teste');
    test('T70 GET /busca-global', buscaGlobal.status === 200, `status=${buscaGlobal.status}`);

    const contasResumo = await req('GET', '/api/financeiro/contas/resumo');
    test('T71 GET /contas/resumo', contasResumo.status === 200, `status=${contasResumo.status}`);

    // Pagamento em lote (core.js)
    const cpLote = await req('POST', '/api/financeiro/contas-pagar/lote/pagar', {
        contas: [], data_pagamento: tomorrow
    });
    test('T72 POST /contas-pagar/lote/pagar (validação)', cpLote.status === 400, `status=${cpLote.status} (esperado 400)`);

    // ============================================================
    // FASE 17: FORNECEDORES E CLIENTES (routes.js)
    // ============================================================
    console.log('\n📋 FASE 17: Fornecedores e Clientes (routes.js)');

    const fornList = await req('GET', '/api/financeiro/fornecedores');
    test('T73 GET /fornecedores', fornList.status === 200 && fornList.data?.success, `status=${fornList.status} ${fornList.raw?.substring(0,200)}`);

    const cliList = await req('GET', '/api/financeiro/clientes');
    test('T74 GET /clientes', cliList.status === 200 && cliList.data?.success, `status=${cliList.status} ${cliList.raw?.substring(0,200)}`);

    // ============================================================
    // FASE 18: VERIFICAÇÃO FRONTEND HTML
    // ============================================================
    console.log('\n📋 FASE 18: Verificação Frontend HTML');

    const htmlDir = path.join(__dirname, 'modules', 'Financeiro');
    const htmlFiles = [
        'index.html', 'contas-pagar.html', 'contas-receber.html', 'fluxo-caixa.html',
        'bancos.html', 'relatorios.html', 'conciliacao.html', 'centros-custo.html',
        'impostos.html', 'orcamentos.html', 'plano-contas.html'
    ];

    let htmlTestNum = 75;
    for (const file of htmlFiles) {
        const filePath = path.join(htmlDir, file);
        try {
            const content = fs.readFileSync(filePath, 'utf8');

            // Verificar se todas as funções onclick referenciadas existem como function
            const onclickRefs = content.match(/onclick="([^"(]+)\(/g) || [];
            const functionDefs = content.match(/function\s+(\w+)\s*\(/g) || [];
            const asyncFuncDefs = content.match(/async\s+function\s+(\w+)\s*\(/g) || [];
            const arrowFuncDefs = content.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g) || [];

            const definedFuncs = new Set();
            functionDefs.forEach(f => { const m = f.match(/function\s+(\w+)/); if (m) definedFuncs.add(m[1]); });
            asyncFuncDefs.forEach(f => { const m = f.match(/function\s+(\w+)/); if (m) definedFuncs.add(m[1]); });
            arrowFuncDefs.forEach(f => { const m = f.match(/(?:const|let|var)\s+(\w+)/); if (m) definedFuncs.add(m[1]); });
            // Also check for methods defined in window scope
            const windowFuncs = content.match(/window\.(\w+)\s*=/g) || [];
            windowFuncs.forEach(f => { const m = f.match(/window\.(\w+)/); if (m) definedFuncs.add(m[1]); });

            const missingFuncs = [];
            const seenFuncs = new Set();
            onclickRefs.forEach(ref => {
                const m = ref.match(/onclick="([^"(]+)/);
                if (m) {
                    const funcName = m[1].trim();
                    // Skip built-in or common patterns
                    if (['window.location', 'window.open', 'window.print', 'history.back',
                         'document.', 'this.', 'event.', 'return ', 'alert', 'confirm'].some(s => funcName.includes(s))) return;
                    if (!seenFuncs.has(funcName)) {
                        seenFuncs.add(funcName);
                        if (!definedFuncs.has(funcName)) {
                            missingFuncs.push(funcName);
                        }
                    }
                }
            });

            // Verificar links quebrados para outras páginas do módulo
            const hrefLinks = content.match(/href="([^"]+\.html)"/g) || [];
            const brokenLinks = [];
            hrefLinks.forEach(link => {
                const m = link.match(/href="([^"]+)"/);
                if (m) {
                    const target = m[1];
                    if (!target.startsWith('http') && !target.startsWith('#') && !target.startsWith('/')) {
                        const targetPath = path.join(htmlDir, target);
                        if (!fs.existsSync(targetPath)) {
                            brokenLinks.push(target);
                        }
                    }
                }
            });

            // Verificar URLs de API no JavaScript
            const apiCalls = content.match(/['"`]\/api\/financeiro\/[^'"`]+['"`]/g) || [];
            const fetchCalls = content.match(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g) || [];

            const allOk = missingFuncs.length === 0 && brokenLinks.length === 0;
            let detail = '';
            if (missingFuncs.length > 0) detail += `FUNCS_FALTANDO=[${missingFuncs.join(',')}] `;
            if (brokenLinks.length > 0) detail += `LINKS_QUEBRADOS=[${brokenLinks.join(',')}] `;

            test(`T${htmlTestNum} HTML ${file}`, allOk, detail || `apis=${apiCalls.length} funcs=${definedFuncs.size}`);
        } catch (e) {
            test(`T${htmlTestNum} HTML ${file}`, false, `Erro ao ler: ${e.message}`);
        }
        htmlTestNum++;
    }

    // ============================================================
    // RESUMO
    // ============================================================
    console.log('\n' + '='.repeat(70));
    console.log(`  RESULTADO: ${pass}/${totalTests} testes passando (${(pass/totalTests*100).toFixed(1)}%)`);
    console.log(`  ✅ Passou: ${pass}  |  ❌ Falhou: ${fail}`);
    console.log('='.repeat(70));

    if (failures.length > 0) {
        console.log('\n❌ FALHAS DETALHADAS:');
        failures.forEach((f, i) => console.log(`  ${i+1}. ${f}`));
    }

    console.log('\nIDs criados durante teste:', JSON.stringify(createdIds));
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
