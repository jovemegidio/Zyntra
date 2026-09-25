'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const api = ler('modules/Faturamento/api/faturamento.js');
const front = ler('modules/Faturamento/public/index.html');

test('a vigilância do log fiscal começa no boot do módulo Faturamento (não só na primeira emissão)', () => {
    assert.match(api, /require\('\.\.\/\.\.\/\.\.\/services\/nfe-confirmacao-audit\.service'\)\.iniciarVigilancia\(pool\)/);
    const boot = api.indexOf('.iniciarVigilancia(pool)');
    const rotas = api.indexOf("router.get('/confirmacoes/status'");
    assert.ok(boot > 0 && boot < rotas);
});

test('rotas de integridade do log: só administrador, e o status é cacheado', () => {
    for (const rota of ['/confirmacoes/verificar-cadeia', '/confirmacoes/status', '/confirmacoes/espelho']) {
        const i = api.indexOf(`router.get('${rota}'`);
        assert.ok(i > 0, `rota ${rota} registrada`);
        assert.match(api.slice(i, i + 400), /if \(!ehAdminFiscal\(req\)\) return negarNaoAdmin\(res\);/, `${rota} exige admin`);
    }
    assert.match(api, /const ehAdminFiscal = \(req\) => \['admin', 'administrador', 'superadmin'\]/);
    assert.match(api, /Date\.now\(\) - em_cache\.ts < 60000/);
});

test('o status da tela nunca devolve a chave nem linhas do log', () => {
    const i = api.indexOf("router.get('/confirmacoes/status'");
    const bloco = api.slice(i, api.indexOf("router.get('/confirmacoes/espelho'"));
    assert.doesNotMatch(bloco, /NFE_AUDIT_HMAC_KEY|process\.env/);
    assert.doesNotMatch(bloco, /recuperarDoEspelho|listarPorNfe/); // conteúdo das linhas só na rota /espelho
});

test('front: faixa vermelha para inconsistência, âmbar dispensável para proteção incompleta; falha silenciosa para não admin', () => {
    assert.match(front, /async function verificarIntegridadeLogFiscal\(\)/);
    assert.match(front, /\/api\/faturamento\/confirmacoes\/status/);
    assert.match(front, /if \(!r\.ok\) return;/);              // 403 (não admin): sem faixa
    assert.match(front, /s\.integra === false/);
    assert.match(front, /#b91c1c/);                            // vermelha
    assert.match(front, /#b45309/);                            // âmbar
    assert.match(front, /textContent = msg/);                  // nunca innerHTML com dado do servidor
    assert.match(front, /if \(s\.integra !== false\)/);        // só o aviso âmbar pode ser dispensado
});
