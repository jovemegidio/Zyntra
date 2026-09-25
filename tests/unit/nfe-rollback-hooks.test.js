'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const emitter = ler('services/nfe-emitter.service.js');
const vendas = ler('routes/vendas-routes.js');
const fat = ler('modules/Faturamento/api/faturamento.js');
const front = ler('modules/Faturamento/public/index.html');

test('emitter: rollback automático é opt-in e só roda quando a SEFAZ não autorizou', () => {
    assert.match(emitter, /reverterFaturamentoAoFalhar = false/);
    assert.match(emitter, /if \(!resultado\.autorizado && reverterFaturamentoAoFalhar\) \{\s*rollback = await require\('\.\/nfe-rollback\.service'\)\.aoRejeitar\(pool, nfeId/);
    // depois de gravar a rejeição na nota, antes de vincular recebíveis
    const rejeitada = emitter.indexOf("SET status = 'rejeitada'");
    const gancho = emitter.indexOf("require('./nfe-rollback.service')");
    const vinculo = emitter.indexOf('Autorizada: liga a nota aos recebíveis');
    assert.ok(rejeitada > 0 && gancho > rejeitada && vinculo > gancho, 'ordem: grava rejeição → rollback → vínculo');
    assert.match(emitter, /status: resultado\.autorizado \? 'autorizada' : 'rejeitada',\s*rollback\s*\};/);
});

test('faturar: só o Faturar integral opta pelo rollback e o pedido revertido não vira "faturado" nem pendente', () => {
    assert.equal(vendas.split('reverterFaturamentoAoFalhar: true').length - 1, 1);
    assert.match(vendas, /let pedidoRevertido = null;/);
    assert.match(vendas, /if \(gerarNFe && !pedidoRevertido\) \{\s*const motivoPersistir/);
    const resposta = vendas.indexOf("errorCode: 'NFE_REJEITADA_FATURAMENTO_REVERTIDO'");
    const notificacao = vendas.indexOf('// 5. Notificação (fora da transação)');
    assert.ok(resposta > 0 && resposta < notificacao, 'a resposta do rollback sai antes da notificação de faturado');
    assert.match(vendas, /pedido_faturado: false,\s*pedido_revertido: true/);
    assert.match(vendas, /nfePendente = null;/);
});

test('enviar-sefaz recusa nota revertida antes de assinar/transmitir', () => {
    const guarda = fat.indexOf("errorCode: 'NFE_REVERTIDA'");
    const assinatura = fat.indexOf('certificadoService.assinarXML(nfe.xml_nfe');
    assert.ok(guarda > 0 && guarda < assinatura);
    assert.match(fat, /if \(nfe\.rollback_em\) \{/);
});

test('rotas do rollback manual: simulação por GET, execução por POST com confirmação e RBAC', () => {
    assert.match(fat, /router\.get\('\/nfes\/:id\/rollback', authenticateToken/);
    assert.match(fat, /router\.post\('\/nfes\/:id\/rollback', authenticateToken/);
    const post = fat.slice(fat.indexOf("router.post('/nfes/:id/rollback'"));
    assert.match(post.slice(0, 1400), /podeReemitirNfe/);
    assert.match(post.slice(0, 1800), /req\.body\?\.confirmar !== true/);
    assert.match(post, /origem: 'manual'/);
    assert.match(post, /consultarAutorizacaoSilenciosa\(chave, uf, tpAmb\)/);
    // não cria rota nova em routes/index.js (diverge entre instâncias): fica no router do Faturamento
});

test('front: menu oferece "Desfazer faturamento" só para nota rejeitada/erro, com simulação e confirmação', () => {
    assert.match(front, /podeDesfazerFaturamento = n\.origem !== 'pedido' && \['rejeitada', 'erro'\]\.includes\(statusC\) && !n\.rollback_em/);
    assert.match(front, /desfazerFaturamentoNFe\(\$\{n\.id\}\)/);
    assert.match(front, /async function desfazerFaturamentoNFe\(id\)/);
    assert.match(front, /confirmar: true/);
});
