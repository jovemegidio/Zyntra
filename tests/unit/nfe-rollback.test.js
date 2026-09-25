'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const audit = require('../../services/nfe-confirmacao-audit.service');
const rollback = require('../../services/nfe-rollback.service');

const T0 = new Date('2026-09-25T12:00:00Z');
const minutosAntes = n => new Date(T0.getTime() - n * 60000);

// Banco falso em memória: só roteia as consultas que o serviço faz e registra as escritas.
function criarBanco(dados = {}) {
    const nfePadrao = {
        nfe: { id: 10, numero: 950, serie: 1, pedido_id: 77, status: 'rejeitada', finalidade: '1', chave_acesso: '3'.repeat(44),
               sefaz_codigo_status: '539', sefaz_tipo_retorno: 'rejeicao', sefaz_ambiente: 'producao', emitente_uf: 'SP',
               protocolo_autorizacao: null, created_at: T0, rollback_em: null, xml_assinado: '<x/>' },
        pedido: { id: 77, status: 'faturado', status_logistica: 'pendente' },
        historico: { id: 1, pedido_id: 77, acao: 'faturamento', created_at: minutosAntes(1), meta: JSON.stringify({ status_anterior: 'aprovado' }) },
        movs: [{ id: 1, codigo_material: 'CAB-01', quantidade: 5 }],
        jaEstornado: 0,
        titulos: [{ id: 300, status: 'a_vencer', valor: 1000 }],
        produto: { id: 9, codigo: 'CAB-01', estoque_atual: 20 },
        colunasPedido: ['id', 'status', 'nf', 'numero_nf', 'nfe_id', 'nfe_chave', 'nfe_protocolo', 'nfe_faturamento_numero', 'nfe_erro', 'data_faturamento', 'status_logistica', 'updated_at'],
        parcial: null, outraAutorizada: 0
    };
    const d = { ...nfePadrao, ...dados, nfe: { ...nfePadrao.nfe, ...(dados.nfe || {}) } };
    const escritas = [];
    const tx = { begin: 0, commit: 0, rollback: 0 };
    const conn = {
        async beginTransaction() { tx.begin++; },
        async commit() { tx.commit++; },
        async rollback() { tx.rollback++; },
        release() {},
        async query(sql, params = []) {
            const s = sql.replace(/\s+/g, ' ').trim();
            if (/^ALTER TABLE nfes ADD COLUMN/.test(s)) return [{}];
            if (/^SELECT \* FROM nfes WHERE id/.test(s)) return [[d.nfe]];
            if (/^SELECT \* FROM pedidos WHERE id/.test(s)) return [[d.pedido]];
            if (/FROM pedido_faturamentos/.test(s)) return [d.parcial ? [d.parcial] : []];
            if (/^SELECT \* FROM pedido_historico/.test(s)) return [[d.historico]];
            if (/FROM estoque_movimentacoes WHERE documento_tipo = 'pedido' AND/.test(s)) return [d.movs];
            if (/SELECT COUNT\(\*\) AS n FROM estoque_movimentacoes/.test(s)) return [[{ n: d.jaEstornado }]];
            if (/FROM contas_receber WHERE pedido_id/.test(s)) return [d.titulos];
            if (/^SELECT id, codigo, estoque_atual FROM produtos/.test(s)) return [[d.produto]];
            if (/^SHOW COLUMNS FROM pedidos/.test(s)) return [d.colunasPedido.map(Field => ({ Field }))];
            if (/^SELECT COUNT\(\*\) AS n FROM nfes/.test(s)) return [[{ n: d.outraAutorizada }]];
            if (/^(UPDATE|INSERT)/.test(s)) { escritas.push({ sql: s, params }); return [{ affectedRows: 1 }]; }
            throw new Error('SQL inesperado no teste: ' + s);
        }
    };
    const pool = { ...conn, getConnection: async () => conn, query: conn.query };
    return { pool, escritas, tx, d };
}

// O log de auditoria é testado à parte; aqui só registramos o que seria gravado.
const logs = [];
audit.registrar = async (_pool, evt) => { logs.push(evt); return { id: logs.length }; };
const usuario = { id: 7, nome: 'Ana Fiscal' };
const escreveu = (escritas, re) => escritas.filter(e => re.test(e.sql));

test('classifica o retorno da SEFAZ de forma conservadora', () => {
    const c = rollback.classificarRetorno;
    assert.equal(c({ status: 'autorizada' }), 'AUTORIZADA');
    assert.equal(c({ status: 'rejeitada', protocolo_autorizacao: '135' }), 'AUTORIZADA');
    assert.equal(c({ status: 'rejeitada', sefaz_codigo_status: '100', sefaz_tipo_retorno: 'rejeicao' }), 'AUTORIZADA');
    assert.equal(c({ status: 'rejeitada', sefaz_codigo_status: '301', sefaz_tipo_retorno: 'rejeicao' }), 'DENEGADA');
    assert.equal(c({ status: 'cancelada' }), 'FINALIZADA');
    assert.equal(c({ status: 'rejeitada', sefaz_codigo_status: '930', sefaz_tipo_retorno: 'rejeicao' }), 'REJEICAO_DEFINITIVA');
    assert.equal(c({ status: 'rejeitada', sefaz_codigo_status: '610', sefaz_tipo_retorno: 'rejeicao' }), 'REJEICAO_DEFINITIVA');
    // duplicidade: a nota pode já existir autorizada
    assert.equal(c({ status: 'rejeitada', sefaz_codigo_status: '204', sefaz_tipo_retorno: 'rejeicao' }), 'INCERTA');
    assert.equal(c({ status: 'rejeitada', sefaz_codigo_status: '539', sefaz_tipo_retorno: 'rejeicao' }), 'INCERTA');
    // comunicação, credencial e desconhecido: incerto
    assert.equal(c({ status: 'erro', sefaz_codigo_status: 'SEFAZ_ERRO', sefaz_tipo_retorno: 'comunicacao' }), 'INCERTA');
    assert.equal(c({ status: 'erro', sefaz_codigo_status: 'CREDENCIAL_SEFAZ', sefaz_tipo_retorno: 'credencial' }), 'INCERTA');
    assert.equal(c({ status: 'processando' }), 'INCERTA');
    // nunca saiu do servidor
    assert.equal(c({ status: 'erro', sefaz_codigo_status: 'CERTIFICADO_INVALIDO', sefaz_tipo_retorno: 'certificado' }), 'NAO_TRANSMITIDA');
    assert.equal(c({ status: 'pendente' }), 'NAO_TRANSMITIDA');
});

test('rollback integral: pedido volta ao status anterior, estoque estornado, título cancelado, nota encerrada', async () => {
    logs.length = 0;
    const { pool, escritas, tx } = criarBanco({ nfe: { sefaz_codigo_status: '930' } });
    const r = await rollback.executar(pool, 10, { origem: 'manual', usuario, motivo: 'teste' });

    assert.equal(r.revertida, true);
    assert.equal(r.escopo, 'FATURAMENTO_INTEGRAL');
    assert.deepEqual([tx.begin, tx.commit, tx.rollback], [1, 1, 0]);

    const produto = escreveu(escritas, /^UPDATE produtos SET estoque_atual/)[0];
    assert.deepEqual(produto.params, [25, 9], 'estoque 20 + 5 devolvidos');
    const mov = escreveu(escritas, /^INSERT INTO estoque_movimentacoes/)[0];
    assert.match(mov.sql, /'entrada', 'ajuste'/);
    assert.match(mov.sql, /'pedido_rollback'/);

    const titulo = escreveu(escritas, /^UPDATE contas_receber SET status = 'cancelada'/)[0];
    assert.equal(titulo.params[1], 300);

    const pedido = escreveu(escritas, /^UPDATE pedidos SET/)[0];
    assert.match(pedido.sql, /status = \?/);
    assert.match(pedido.sql, /nfe_id = NULL/);
    assert.match(pedido.sql, /numero_nf = NULL/);
    assert.match(pedido.sql, /data_faturamento = NULL/);
    assert.match(pedido.sql, /status_logistica = NULL/);
    assert.equal(pedido.params[0], 'aprovado');
    assert.equal(pedido.params.at(-1), 77);

    const nota = escreveu(escritas, /^UPDATE nfes SET rollback_em/)[0];
    assert.match(nota.sql, /pedido_id_origem = pedido_id, pedido_id = NULL/);
    assert.equal(nota.params[1], 7);
    assert.ok(escreveu(escritas, /^INSERT INTO pedido_historico/)[0].params.includes('rollback_faturamento'));

    assert.deepEqual(r.plano.numeroLacuna, { numero: 950, serie: 1 });
    assert.equal(logs.at(-1).evento, audit.EVENTOS.ROLLBACK);
    assert.equal(logs.at(-1).usuarioId, 7);
});

test('nota autorizada NUNCA é revertida (nada é escrito)', async () => {
    logs.length = 0;
    const { pool, escritas, tx } = criarBanco({ nfe: { status: 'autorizada', protocolo_autorizacao: '135260000001', sefaz_codigo_status: null } });
    await assert.rejects(rollback.executar(pool, 10, { usuario }), e => e.code === 'NOTA_AUTORIZADA');
    assert.equal(escreveu(escritas, /^UPDATE|^INSERT/).length, 0);
    assert.equal(tx.rollback, 1);
    assert.equal(logs.at(-1).evento, audit.EVENTOS.ROLLBACK_RECUSADO);
});

test('nota denegada não é revertida', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '301' } });
    await assert.rejects(rollback.executar(pool, 10, { usuario }), e => e.code === 'NOTA_DENEGADA');
    assert.equal(escritas.length, 0);
});

test('resultado incerto: consulta a SEFAZ; se está autorizada lá, não reverte', async () => {
    const { pool, escritas } = criarBanco({ nfe: { status: 'erro', sefaz_codigo_status: 'SEFAZ_ERRO', sefaz_tipo_retorno: 'comunicacao' } });
    await assert.rejects(
        rollback.executar(pool, 10, { usuario, consultar: async () => ({ autorizado: true, codigoStatus: '100' }) }),
        e => e.code === 'AUTORIZADA_NA_SEFAZ');
    assert.equal(escritas.length, 0);
});

test('resultado incerto: consulta indisponível, cStat inconclusivo ou sem consultor → nada é revertido', async () => {
    const base = { nfe: { status: 'erro', sefaz_codigo_status: 'SEFAZ_ERRO', sefaz_tipo_retorno: 'comunicacao' } };
    for (const [consultar, codigo] of [
        [async () => null, 'SEFAZ_INDISPONIVEL_CONSULTA'],
        [async () => ({ codigoStatus: '105', motivo: 'Lote em processamento' }), 'RESULTADO_INCERTO'],
        [undefined, 'RESULTADO_INCERTO']
    ]) {
        const { pool, escritas } = criarBanco(base);
        await assert.rejects(rollback.executar(pool, 10, { usuario, consultar }), e => e.code === codigo);
        assert.equal(escritas.length, 0);
    }
});

test('resultado incerto: SEFAZ confirma cStat 217 (não consta na base) → reverte', async () => {
    const { pool, escritas } = criarBanco({ nfe: { status: 'erro', sefaz_codigo_status: 'SEFAZ_ERRO', sefaz_tipo_retorno: 'comunicacao' } });
    let chamada;
    const r = await rollback.executar(pool, 10, { usuario, consultar: async (...a) => { chamada = a; return { codigoStatus: '217', autorizado: false }; } });
    assert.equal(r.revertida, true);
    assert.deepEqual(chamada, ['3'.repeat(44), 'SP', '1']);
    assert.equal(escreveu(escritas, /^UPDATE nfes SET rollback_em/).length, 1);
});

test('título já recebido bloqueia o rollback inteiro (nada é escrito)', async () => {
    const { pool, escritas, tx } = criarBanco({ nfe: { sefaz_codigo_status: '930' }, titulos: [{ id: 300, status: 'liquidada', valor: 1000 }] });
    await assert.rejects(rollback.executar(pool, 10, { usuario }), e => e.code === 'TITULO_RECEBIDO');
    assert.equal(escreveu(escritas, /^UPDATE|^INSERT/).length, 0);
    assert.equal(tx.rollback, 1);
});

test('faturamento parcial (meia nota) não é revertido por aqui', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '930' }, parcial: { id: 5 } });
    await assert.rejects(rollback.executar(pool, 10, { usuario }), e => e.code === 'FATURAMENTO_PARCIAL_MANUAL');
    assert.equal(escritas.length, 0);
});

test('devolução (finalidade 4): só a nota é encerrada; pedido, estoque e título ficam intactos', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '930', finalidade: '4' } });
    const r = await rollback.executar(pool, 10, { usuario });
    assert.equal(r.escopo, 'SOMENTE_NOTA');
    assert.equal(escreveu(escritas, /produtos|estoque_movimentacoes|contas_receber|UPDATE pedidos/).length, 0);
    assert.equal(escreveu(escritas, /^UPDATE nfes SET rollback_em/).length, 1);
});

test('reemissão (faturamento anterior fora da janela da nota): pedido não é desfeito', async () => {
    const { pool, escritas } = criarBanco({
        nfe: { sefaz_codigo_status: '930' },
        historico: { id: 1, acao: 'faturamento', created_at: new Date(T0.getTime() - 3 * 24 * 3600 * 1000), meta: '{}' }
    });
    const r = await rollback.executar(pool, 10, { usuario });
    assert.equal(r.escopo, 'SOMENTE_NOTA');
    assert.equal(escreveu(escritas, /produtos|estoque_movimentacoes|contas_receber|UPDATE pedidos/).length, 0);
});

test('pedido que não está "faturado" não é alterado', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '930' }, pedido: { id: 77, status: 'aprovado' } });
    const r = await rollback.executar(pool, 10, { usuario });
    assert.equal(r.escopo, 'SOMENTE_NOTA');
    assert.equal(escreveu(escritas, /UPDATE pedidos/).length, 0);
});

test('estoque já estornado não é devolvido duas vezes', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '930' }, jaEstornado: 1 });
    const r = await rollback.executar(pool, 10, { usuario });
    assert.equal(r.plano.estoque.length, 0);
    assert.equal(escreveu(escritas, /^UPDATE produtos/).length, 0);
});

test('idempotente: nota já revertida não é revertida de novo', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '930', rollback_em: T0 } });
    await assert.rejects(rollback.executar(pool, 10, { usuario }), e => e.code === 'JA_REVERTIDA');
    assert.equal(escreveu(escritas, /^UPDATE|^INSERT/).length, 0);
});

test('automático só roda em rejeição definitiva; aoRejeitar nunca lança', async () => {
    const incerta = criarBanco({ nfe: { status: 'erro', sefaz_codigo_status: 'SEFAZ_ERRO', sefaz_tipo_retorno: 'comunicacao' } });
    await assert.rejects(rollback.executar(incerta.pool, 10, { origem: 'automatico', usuario }),
        e => e.code === 'AUTOMATICO_SOMENTE_REJEICAO_DEFINITIVA');
    const r = await rollback.aoRejeitar(incerta.pool, 10, { usuario });
    assert.equal(r.revertida, false);
    assert.equal(r.codigo, 'AUTOMATICO_SOMENTE_REJEICAO_DEFINITIVA');
    const ok = criarBanco({ nfe: { sefaz_codigo_status: '930' } });
    assert.equal((await rollback.aoRejeitar(ok.pool, 10, { usuario })).revertida, true);
});

test('simular devolve o plano sem escrever nada', async () => {
    const { pool, escritas } = criarBanco({ nfe: { sefaz_codigo_status: '930' } });
    const plano = await rollback.simular(pool, 10);
    assert.equal(plano.escopo, 'FATURAMENTO_INTEGRAL');
    assert.equal(plano.statusAnterior, 'aprovado');
    assert.deepEqual(plano.estoque, [{ codigo: 'CAB-01', quantidade: 5 }]);
    assert.equal(plano.titulos.length, 1);
    assert.equal(escreveu(escritas, /^UPDATE|^INSERT/).length, 0);
});
