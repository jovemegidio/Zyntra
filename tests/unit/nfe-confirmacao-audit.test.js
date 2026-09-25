'use strict';

process.env.NFE_AUDIT_VIGILANCIA = 'off';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const audit = require('../../services/nfe-confirmacao-audit.service');
const gate = require('../../services/nfe-envio-gate.service');

// Ambiente isolado por teste: pasta de âncoras própria (senão os ids de um teste,
// que reiniciam em 1, colidiriam com as âncoras do anterior) e chave conhecida.
function novoAmbiente({ chave = 'chave-de-teste-nfe-audit-0123456789' } = {}) {
    process.env.NFE_AUDIT_ANCHOR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-anchor-'));
    if (chave) process.env.NFE_AUDIT_HMAC_KEY = chave; else delete process.env.NFE_AUDIT_HMAC_KEY;
}
const restaurarAmbiente = () => { delete process.env.NFE_AUDIT_HMAC_KEY; delete process.env.NFE_AUDIT_ANCHOR_DIR; };

// Pool falso em memória: implementa só o que o serviço usa.
function fakePool() {
    const rows = [];
    const conn = {
        async query(sql, params) {
            if (/GET_LOCK/.test(sql)) return [[{ ok: 1 }]];
            if (/RELEASE_LOCK/.test(sql)) return [[{}]];
            if (/SELECT hash_registro/.test(sql)) {
                const ultimo = rows.filter(r => r.empresa_id === params[0]).slice(-1)[0];
                return [ultimo ? [{ hash_registro: ultimo.hash_registro }] : []];
            }
            if (/^INSERT INTO nfe_confirmacoes_emissao/.test(sql.trim())) {
                const cols = sql.match(/\(([^)]+)\) VALUES/)[1].split(',').map(s => s.trim());
                const row = { id: rows.length + 1 };
                cols.forEach((c, i) => { row[c] = params[i]; });
                rows.push(row);
                return [{ insertId: row.id }];
            }
            throw new Error('SQL inesperado: ' + sql);
        },
        release() {}
    };
    return {
        rows,
        async query(sql, params) {
            if (/CREATE (TABLE|TRIGGER)|^ALTER TABLE/.test(sql.trim())) return [{}];
            if (/^SELECT \* FROM nfe_confirmacoes_emissao/.test(sql.trim())) {
                return [rows.filter(r => r.empresa_id === params[0]).map(r => ({ ...r }))];
            }
            return conn.query(sql, params);
        },
        async getConnection() { return conn; }
    };
}

const req = {
    user: { id: 7, nome: 'Ana Fiscal', email: 'ana@empresa.com', role: 'fiscal' },
    headers: { 'user-agent': 'TesteAgent/1.0', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    body: { confirmacaoEnvio: { aceite: true, origem: 'modal-confirmar-envio' } }
};

const XML_COMPLETO = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe>
  <ide><natOp>Venda</natOp><tpNF>1</tpNF><idDest>1</idDest><finNFe>1</finNFe><indPres>1</indPres><tpAmb>2</tpAmb></ide>
  <emit><CNPJ>68192475000160</CNPJ><xNome>EMITENTE</xNome><enderEmit><UF>SP</UF></enderEmit><IE>111222333444</IE><CRT>3</CRT></emit>
  <dest><CNPJ>11222333000181</CNPJ><xNome>CLIENTE</xNome><enderDest><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>SP</UF><CEP>01001000</CEP></enderDest><indIEDest>1</indIEDest><IE>123456789012</IE></dest>
  <det nItem="1"><prod><cProd>A</cProd><xProd>Cabo</xProd><NCM>85444200</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>100.00</vUnCom><vProd>100.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS>
    <PIS><PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>0.65</pPIS><vPIS>0.65</vPIS></PISAliq></PIS>
    <COFINS><COFINSAliq><CST>01</CST><vBC>100.00</vBC><pCOFINS>3.00</pCOFINS><vCOFINS>3.00</vCOFINS></COFINSAliq></COFINS></imposto></det>
  <transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>100.00</vPag></detPag></pag></infNFe></NFe>`;

async function gravar(pool, n, extra = {}) {
    for (let i = 0; i < n; i++) {
        await audit.registrar(pool, { evento: audit.EVENTOS.CONFIRMADO, categoria: 'VENDA', usuarioId: 7, nfeId: 100 + i, ...extra });
    }
}

// O que um atacante com acesso de ESCRITA ao MySQL (mas sem a chave do servidor) faria:
// altera uma linha e recalcula, com SHA-256 simples, o hash dela e das seguintes.
function recalcularComoAtacante(rows, aPartirDoIndice) {
    let anterior = aPartirDoIndice === 0 ? '0'.repeat(64) : rows[aPartirDoIndice - 1].hash_registro;
    for (let i = aPartirDoIndice; i < rows.length; i++) {
        rows[i].hash_anterior = anterior;
        rows[i].hash_registro = crypto.createHash('sha256').update(anterior + audit.conteudoCanonico(rows[i])).digest('hex');
        anterior = rows[i].hash_registro;
    }
}

test('registra usuário, categoria e horário do servidor, com hash do XML', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await audit.registrar(pool, {
            evento: audit.EVENTOS.CONFIRMADO, categoria: 'VENDA', nfeId: '55', xml: '<NFe/>',
            cfops: ['5102'], ...audit.identidadeConfirmada(req)
        });
        const r = pool.rows[0];
        assert.equal(r.usuario_id, 7);
        assert.equal(r.usuario_nome, 'Ana Fiscal');
        assert.equal(r.ip, '203.0.113.9');
        assert.equal(r.categoria, 'VENDA');
        assert.equal(r.nfe_id, 55);
        assert.equal(r.confirmou_em_tela, 1);
        assert.equal(r.origem_confirmacao, 'modal-confirmar-envio');
        assert.equal(r.xml_sha256, audit.sha256('<NFe/>'));
        assert.match(r.registrado_em_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        assert.equal(r.hash_anterior, '0'.repeat(64));
        assert.equal(r.hash_alg, 'hmac-sha256', 'com chave configurada o hash é HMAC');
        assert.ok(r.hash_kid);
    } finally { restaurarAmbiente(); }
});

test('cadeia de hashes: íntegra, e adulteração de qualquer linha é apontada', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        assert.equal(pool.rows[1].hash_anterior, pool.rows[0].hash_registro);
        const ok = await audit.verificarCadeia(pool);
        assert.equal(ok.integra, true);
        assert.equal(ok.registros, 3);
        assert.equal(ok.primeiroInvalidoId, null);

        pool.rows[1].usuario_id = 999; // alguém troca o autor no banco
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.primeiroInvalidoId, 2);
        assert.equal(r.motivo, 'HASH_NAO_CONFERE');

        pool.rows[1].usuario_id = 7;
        pool.rows.splice(0, 1); // ou apaga a primeira linha
        assert.equal((await audit.verificarCadeia(pool)).integra, false);
    } finally { restaurarAmbiente(); }
});

test('ATAQUE: quem só escreve no banco edita a linha e RECALCULA a cadeia com SHA-256 — o HMAC denuncia', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 4);
        pool.rows[1].usuario_id = 999;             // troca o autor
        recalcularComoAtacante(pool.rows, 1);      // e "conserta" a cadeia inteira dali para a frente
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.primeiroInvalidoId, 2);
        assert.equal(r.motivo, 'HASH_NAO_CONFERE');
    } finally { restaurarAmbiente(); }
});

test('ATAQUE: rebaixar o algoritmo para sha256 nas linhas adulteradas é detectado', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 4);
        pool.rows[2].usuario_id = 999;
        for (const i of [2, 3]) { pool.rows[i].hash_alg = 'sha256'; pool.rows[i].hash_kid = null; }
        recalcularComoAtacante(pool.rows, 2);
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.primeiroInvalidoId, 3);
        assert.equal(r.motivo, 'REBAIXAMENTO_DE_ALGORITMO');
    } finally { restaurarAmbiente(); }
});

test('ATAQUE: apagar as ÚLTIMAS linhas deixa a cadeia válida — a âncora fora do banco denuncia', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 4);
        pool.rows.splice(2, 2); // corta o fim do log
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.motivo, 'LINHA_APAGADA_OU_TRUNCADA');
        assert.equal(r.primeiroInvalidoId, 3);
        assert.equal(r.ancora.problemas.length, 2);
    } finally { restaurarAmbiente(); }
});

test('ATAQUE: TRUNCATE da tabela inteira também é detectado pelas âncoras', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        pool.rows.length = 0;
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.motivo, 'LINHA_APAGADA_OU_TRUNCADA');
        assert.equal(r.registros, 0);
    } finally { restaurarAmbiente(); }
});

test('âncora forjada (sem o MAC correto) é rejeitada', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 2);
        const arquivo = audit.arquivoAncora(1);
        fs.appendFileSync(arquivo, JSON.stringify({ e: 1, id: 99, h: 'a'.repeat(64), p: 'b'.repeat(64), alg: 'hmac-sha256', t: '2026-01-01T00:00:00.000Z', m: 'c'.repeat(64) }) + '\n');
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.motivo, 'ANCORA_ADULTERADA');
    } finally { restaurarAmbiente(); }
});

test('sem arquivo de âncora a cadeia continua verificável (só perde a proteção contra corte do fim)', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        fs.rmSync(audit.arquivoAncora(1));
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, true);
        assert.equal(r.ancora.existe, false);
        assert.equal(r.ancora.semAncora, 3);
    } finally { restaurarAmbiente(); }
});

test('cada linha gravada gera uma âncora encadeada na mesma ordem da cadeia', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        const linhas = fs.readFileSync(audit.arquivoAncora(1), 'utf8').trim().split('\n').map(JSON.parse);
        assert.deepEqual(linhas.map(a => a.id), [1, 2, 3]);
        assert.deepEqual(linhas.map(a => a.h), pool.rows.map(r => r.hash_registro));
        assert.equal(linhas[1].p, linhas[0].h);
        assert.ok(linhas.every(a => a.m && a.alg === 'hmac-sha256'));
    } finally { restaurarAmbiente(); }
});

test('trocar a chave do servidor é sinalizado como CHAVE_DIFERENTE (não como adulteração muda)', async () => {
    novoAmbiente({ chave: 'chave-original-0123456789abcdef' });
    try {
        const pool = fakePool();
        await gravar(pool, 2);
        process.env.NFE_AUDIT_HMAC_KEY = 'outra-chave-completamente-diferente-99';
        const r = await audit.verificarCadeia(pool);
        assert.equal(r.integra, false);
        assert.equal(r.motivo, 'CHAVE_DIFERENTE');
    } finally { restaurarAmbiente(); }
});

test('sem nenhuma chave configurada o log ainda funciona (SHA-256 simples) e continua verificável', async () => {
    const jwt = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
    novoAmbiente({ chave: null });
    const aviso = console.warn; console.warn = () => {};
    try {
        const pool = fakePool();
        await gravar(pool, 2);
        assert.equal(pool.rows[0].hash_alg, 'sha256');
        assert.equal((await audit.verificarCadeia(pool)).integra, true);
    } finally { console.warn = aviso; restaurarAmbiente(); if (jwt !== undefined) process.env.JWT_SECRET = jwt; }
});

test('linhas legadas em SHA-256 (sem hash_alg) continuam verificáveis', async () => {
    const jwt = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
    novoAmbiente({ chave: null });
    const aviso = console.warn; console.warn = () => {};
    try {
        const pool = fakePool();
        await gravar(pool, 2);
        for (const r of pool.rows) { delete r.hash_alg; delete r.hash_kid; } // tabela anterior à coluna
        assert.equal((await audit.verificarCadeia(pool)).integra, true);
    } finally { console.warn = aviso; restaurarAmbiente(); if (jwt !== undefined) process.env.JWT_SECRET = jwt; }
});

test('gate: nota com campo obrigatório faltando é barrada e o bloqueio fica registrado', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        const xmlSemNcm = XML_COMPLETO.replace('<NCM>85444200</NCM>', '');
        await assert.rejects(gate.autorizarEnvio(pool, xmlSemNcm, { req, nfe: { id: 1, numero: 10 } }),
            e => e.code === 'CAMPOS_OBRIGATORIOS_CATEGORIA' && e.status === 422);
        assert.equal(pool.rows.length, 1);
        assert.equal(pool.rows[0].evento, audit.EVENTOS.BLOQUEADO);
        assert.equal(pool.rows[0].usuario_id, 7);
        assert.match(pool.rows[0].pendencias, /NCM/);
    } finally { restaurarAmbiente(); }
});

test('gate: nota completa é liberada e grava usuário + categoria antes de transmitir', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        const r = await gate.autorizarEnvio(pool, XML_COMPLETO, { req, nfe: { id: 1, numero: 10, serie: 1 } });
        assert.equal(r.resultado.ok, true);
        assert.equal(pool.rows.length, 1);
        assert.equal(pool.rows[0].evento, audit.EVENTOS.CONFIRMADO);
        assert.equal(pool.rows[0].categoria, 'VENDA');
        assert.equal(pool.rows[0].usuario_id, 7);
        assert.equal(pool.rows[0].confirmou_em_tela, 1);
        await gate.registrarDesfecho(pool, r, audit.EVENTOS.AUTORIZADA, { codigo: '100', motivo: 'Protocolo 1' });
        assert.equal(pool.rows.length, 2);
        assert.equal(pool.rows[1].evento, audit.EVENTOS.AUTORIZADA);
        assert.equal((await audit.verificarCadeia(pool)).integra, true);
    } finally { restaurarAmbiente(); }
});

test('gate: sem tela de confirmação o envio é registrado com confirmou_em_tela = 0', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gate.autorizarEnvio(pool, XML_COMPLETO, { req: { ...req, body: {} }, nfe: { id: 1 } });
        assert.equal(pool.rows[0].confirmou_em_tela, 0);
    } finally { restaurarAmbiente(); }
});

test('gate: se o log não puder ser gravado, o envio NÃO segue (falha fechada)', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        pool.getConnection = async () => { throw new Error('banco fora'); };
        await assert.rejects(gate.autorizarEnvio(pool, XML_COMPLETO, { req, nfe: { id: 1 } }),
            e => e.code === 'AUDITORIA_INDISPONIVEL' && e.status === 503);
    } finally { restaurarAmbiente(); }
});
