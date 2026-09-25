'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const audit = require('../../services/nfe-confirmacao-audit.service');
const gate = require('../../services/nfe-envio-gate.service');

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
            if (/CREATE (TABLE|TRIGGER)/.test(sql)) return [{}];
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

test('registra usuário, categoria e horário do servidor, com hash do XML', async () => {
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
});

test('cadeia de hashes: íntegra, e adulteração de qualquer linha é apontada', async () => {
    const pool = fakePool();
    for (const cat of ['VENDA', 'DEVOLUCAO', 'BONIFICACAO']) {
        await audit.registrar(pool, { evento: audit.EVENTOS.CONFIRMADO, categoria: cat, usuarioId: 7 });
    }
    assert.equal(pool.rows[1].hash_anterior, pool.rows[0].hash_registro);
    assert.deepEqual(await audit.verificarCadeia(pool), { integra: true, registros: 3, primeiroInvalidoId: null });

    pool.rows[1].usuario_id = 999; // alguém troca o autor no banco
    const r = await audit.verificarCadeia(pool);
    assert.equal(r.integra, false);
    assert.equal(r.primeiroInvalidoId, 2);

    pool.rows[1].usuario_id = 7;
    pool.rows.splice(0, 1); // ou apaga a primeira linha
    assert.equal((await audit.verificarCadeia(pool)).integra, false);
});

test('gate: nota com campo obrigatório faltando é barrada e o bloqueio fica registrado', async () => {
    const pool = fakePool();
    const xmlSemNcm = XML_COMPLETO.replace('<NCM>85444200</NCM>', '');
    await assert.rejects(gate.autorizarEnvio(pool, xmlSemNcm, { req, nfe: { id: 1, numero: 10 } }),
        e => e.code === 'CAMPOS_OBRIGATORIOS_CATEGORIA' && e.status === 422);
    assert.equal(pool.rows.length, 1);
    assert.equal(pool.rows[0].evento, audit.EVENTOS.BLOQUEADO);
    assert.equal(pool.rows[0].usuario_id, 7);
    assert.match(pool.rows[0].pendencias, /NCM/);
});

test('gate: nota completa é liberada e grava usuário + categoria antes de transmitir', async () => {
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
});

test('gate: sem tela de confirmação o envio é registrado com confirmou_em_tela = 0', async () => {
    const pool = fakePool();
    await gate.autorizarEnvio(pool, XML_COMPLETO, { req: { ...req, body: {} }, nfe: { id: 1 } });
    assert.equal(pool.rows[0].confirmou_em_tela, 0);
});

test('gate: se o log não puder ser gravado, o envio NÃO segue (falha fechada)', async () => {
    const pool = fakePool();
    pool.getConnection = async () => { throw new Error('banco fora'); };
    await assert.rejects(gate.autorizarEnvio(pool, XML_COMPLETO, { req, nfe: { id: 1 } }),
        e => e.code === 'AUDITORIA_INDISPONIVEL' && e.status === 503);
});
