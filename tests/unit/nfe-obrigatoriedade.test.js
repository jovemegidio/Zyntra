'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validarXml, classificarCategoria, extrairModeloDoXml, erroObrigatoriedade
} = require('../../services/nfe-obrigatoriedade.service');

const CHAVE = '35260968192475000160550010000001231000001230';

// XML mínimo de NF-e 4.00 (só o que o validador lê), com pontos de troca por opção.
function xml(o = {}) {
    const {
        finNFe = '1', tpNF = '1', idDest = '1', ufDest = 'SP', crt = '3', cfop = '5102',
        icms = '<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00>',
        pis = '<PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>0.65</pPIS><vPIS>0.65</vPIS></PISAliq>',
        cofins = '<COFINSAliq><CST>01</CST><vBC>100.00</vBC><pCOFINS>3.00</pCOFINS><vCOFINS>3.00</vCOFINS></COFINSAliq>',
        ncm = '85444200', cest = '', cbenef = '', nfref = '', dest = null,
        indIEDest = '1', ie = '123456789012', pag = '<detPag><tPag>01</tPag><vPag>100.00</vPag></detPag>', modFrete = '9'
    } = o;
    const destinatario = dest !== null ? dest : `<dest><CNPJ>11222333000181</CNPJ><xNome>CLIENTE LTDA</xNome>
        <enderDest><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>${ufDest}</UF><CEP>01001000</CEP></enderDest>
        <indIEDest>${indIEDest}</indIEDest>${indIEDest === '1' ? `<IE>${ie}</IE>` : ''}</dest>`;
    return `<?xml version="1.0"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00">
        <ide><natOp>Venda</natOp><tpNF>${tpNF}</tpNF><idDest>${idDest}</idDest><finNFe>${finNFe}</finNFe><indFinal>0</indFinal><indPres>1</indPres><tpAmb>2</tpAmb>${nfref}</ide>
        <emit><CNPJ>68192475000160</CNPJ><xNome>EMITENTE</xNome><enderEmit><UF>SP</UF></enderEmit><IE>111222333444</IE><CRT>${crt}</CRT></emit>
        ${destinatario}
        <det nItem="1"><prod><cProd>ABC</cProd><xProd>Cabo</xProd><NCM>${ncm}</NCM>${cest ? `<CEST>${cest}</CEST>` : ''}${cbenef ? `<cBenef>${cbenef}</cBenef>` : ''}<CFOP>${cfop}</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>100.00</vUnCom><vProd>100.00</vProd></prod>
        <imposto><ICMS>${icms}</ICMS><PIS>${pis}</PIS><COFINS>${cofins}</COFINS></imposto></det>
        <transp><modFrete>${modFrete}</modFrete></transp><pag>${pag}</pag></infNFe></NFe>`;
}
const campos = r => r.erros.map(e => e.campo);
const msgs = r => r.erros.map(e => e.mensagem).join(' | ');

test('venda completa e coerente passa sem erros', () => {
    const r = validarXml(xml());
    assert.equal(r.categoria, 'VENDA');
    assert.deepEqual(r.erros, []);
    assert.equal(r.ok, true);
});

test('categoria é derivada do XML: finalidade 4 é devolução; CFOP 5901/5910/5915 tem categoria própria', () => {
    assert.equal(classificarCategoria(extrairModeloDoXml(xml({ finNFe: '4' }))), 'DEVOLUCAO');
    assert.equal(classificarCategoria(extrairModeloDoXml(xml({ cfop: '5901' }))), 'REMESSA_INDUSTRIALIZACAO');
    assert.equal(classificarCategoria(extrairModeloDoXml(xml({ cfop: '6910', idDest: '2', ufDest: 'RJ' }))), 'BONIFICACAO');
    assert.equal(classificarCategoria(extrairModeloDoXml(xml({ cfop: '5915' }))), 'REMESSA_CONSERTO');
    assert.equal(classificarCategoria(extrairModeloDoXml(xml())), 'VENDA');
});

test('ICMS tributado sem alíquota: erro cita o campo e a categoria', () => {
    const r = validarXml(xml({ icms: '<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><vICMS>18.00</vICMS></ICMS00>' }));
    assert.equal(r.ok, false);
    assert.ok(campos(r).includes('alíquota do ICMS (pICMS)'));
    assert.match(msgs(r), /obrigatório para a categoria "Venda de mercadoria"/i);
    assert.match(msgs(r), /CST 00/);
});

test('item sem ICMS/PIS/COFINS declarados é barrado', () => {
    const r = validarXml(xml({ icms: '', pis: '', cofins: '' }).replace('<ICMS></ICMS>', '').replace('<PIS></PIS>', '').replace('<COFINS></COFINS>', ''));
    assert.equal(r.ok, false);
    assert.ok(campos(r).includes('ICMS (grupo de tributação)'));
    assert.ok(campos(r).includes('PIS (grupo de tributação)'));
    assert.ok(campos(r).includes('COFINS (grupo de tributação)'));
});

test('NCM ausente ou inválido é barrado', () => {
    assert.ok(campos(validarXml(xml({ ncm: '' }))).includes('NCM'));
    assert.match(msgs(validarXml(xml({ ncm: '854442' }))), /NCM "854442" inválido/);
});

test('destinatário contribuinte sem IE é barrado; não contribuinte passa', () => {
    assert.ok(campos(validarXml(xml({ ie: '' }))).includes('inscrição estadual do destinatário'));
    assert.equal(validarXml(xml({ indIEDest: '9' })).ok, true);
});

test('CFOP incompatível com o destino da operação (interestadual com 5xxx)', () => {
    const r = validarXml(xml({ idDest: '2', ufDest: 'RJ', cfop: '5102' }));
    assert.equal(r.ok, false);
    assert.match(msgs(r), /não confere com o destino/);
});

test('idDest incoerente com as UFs é barrado', () => {
    const r = validarXml(xml({ idDest: '1', ufDest: 'RJ', cfop: '5102' }));
    assert.match(msgs(r), /idDest=1/);
});

test('ICMS-ST (CST 10) exige base/alíquota/valor do ST e CEST', () => {
    const r = validarXml(xml({ icms: '<ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS10>' }));
    for (const c of ['base de cálculo do ICMS-ST (vBCST)', 'alíquota do ICMS-ST (pICMSST)', 'valor do ICMS-ST (vICMSST)', 'CEST (7 dígitos)']) {
        assert.ok(campos(r).includes(c), `esperava erro para ${c}`);
    }
});

test('Simples Nacional (CRT 1) precisa de CSOSN; regime normal (CRT 3) não pode usar CSOSN', () => {
    assert.ok(campos(validarXml(xml({ crt: '1' }))).includes('CSOSN'));
    const csosn = '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>';
    assert.equal(validarXml(xml({ crt: '1', icms: csosn })).ok, true);
    assert.ok(campos(validarXml(xml({ crt: '3', icms: csosn }))).includes('CST do ICMS'));
});

test('sem falso positivo: Simples Nacional real (CSOSN 102, PIS/COFINS 49 zerados) e CST 60 passam', () => {
    const outr = g => `<${g}Outr><CST>49</CST><vBC>0.00</vBC><p${g}>0.0000</p${g}><v${g}>0.00</v${g}></${g}Outr>`;
    const sn = validarXml(xml({
        crt: '1', icms: '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>',
        pis: outr('PIS'), cofins: outr('COFINS')
    }));
    assert.deepEqual(sn.erros, []);
    const st60 = validarXml(xml({ icms: '<ICMS60><orig>0</orig><CST>60</CST></ICMS60>' }));
    assert.deepEqual(st60.erros, []);
    const isento = validarXml(xml({
        cfop: '5901', icms: '<ICMS40><orig>0</orig><CST>40</CST><vICMSDeson>0.00</vICMSDeson><motDesICMS>9</motDesICMS><indDeduzDeson>1</indDeduzDeson></ICMS40>'.replace('<CST>40</CST>', '<CST>40</CST>')
    }));
    assert.equal(isento.categoria, 'REMESSA_INDUSTRIALIZACAO');
    // CST 40 sem cBenef segue barrado pela regra existente — o que esta trava não pode é inventar outro erro.
    assert.ok(isento.erros.every(e => e.campo === 'cBenef'));
});

test('CSOSN 201 não exige crédito (pCredSN é opcional no XSD)', () => {
    const r = validarXml(xml({
        crt: '1', cest: '2100100',
        icms: '<ICMSSN201><orig>0</orig><CSOSN>201</CSOSN><modBCST>4</modBCST><vBCST>100.00</vBCST><pICMSST>18.0000</pICMSST><vICMSST>18.00</vICMSST></ICMSSN201>'
    }));
    assert.deepEqual(r.erros, []);
});

test('devolução exige a chave da NF-e referenciada, com 44 dígitos', () => {
    const sem = validarXml(xml({ finNFe: '4', cfop: '5202' }));
    assert.ok(campos(sem).includes('chave da NF-e referenciada (refNFe)'));
    assert.match(msgs(sem), /categoria "Devolução"/);
    const curta = validarXml(xml({ finNFe: '4', cfop: '5202', nfref: '<NFref><refNFe>123</refNFe></NFref>' }));
    assert.match(msgs(curta), /44 dígitos/);
    const ok = validarXml(xml({ finNFe: '4', cfop: '5202', nfref: `<NFref><refNFe>${CHAVE}</refNFe></NFref>` }));
    assert.equal(ok.ok, true);
});

test('devolução de venda (entrada, CFOP 1202) é coerente; CFOP de saída em nota de entrada não', () => {
    const ref = `<NFref><refNFe>${CHAVE}</refNFe></NFref>`;
    assert.equal(validarXml(xml({ finNFe: '4', tpNF: '0', cfop: '1202', nfref: ref })).ok, true);
    assert.match(msgs(validarXml(xml({ finNFe: '4', tpNF: '0', cfop: '5202', nfref: ref }))), /é de saída, mas a nota é de entrada/);
});

test('CST 41 sem cBenef segue barrado (regra existente reaproveitada)', () => {
    const r = validarXml(xml({ cfop: '5901', icms: '<ICMS40><orig>0</orig><CST>41</CST></ICMS40>' }));
    assert.equal(r.categoria, 'REMESSA_INDUSTRIALIZACAO');
    assert.match(msgs(r), /cBenef/);
});

test('pagamento: ausente é barrado; "99 Outros" exige descrição; remessa com pagamento só avisa', () => {
    assert.ok(campos(validarXml(xml({ pag: '' }))).includes('forma de pagamento (detPag)'));
    assert.ok(campos(validarXml(xml({ pag: '<detPag><tPag>99</tPag><vPag>100.00</vPag></detPag>' }))).includes('descrição do meio de pagamento (xPag)'));
    const rem = validarXml(xml({ cfop: '5910', icms: '<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00>' }));
    assert.equal(rem.categoria, 'BONIFICACAO');
    assert.equal(rem.ok, true);
    assert.equal(rem.avisos.length, 1);
});

test('modalidade de frete ausente é barrada', () => {
    assert.ok(campos(validarXml(xml({ modFrete: '' }))).includes('modalidade do frete (modFrete)'));
});

test('XML ilegível bloqueia em vez de deixar passar', () => {
    const r = validarXml('isto não é xml');
    assert.equal(r.ok, false);
    assert.equal(r.erros[0].codigo, 'XML_ILEGIVEL');
});

test('erroObrigatoriedade carrega código, status 422 e a lista completa', () => {
    const r = validarXml(xml({ ncm: '', ie: '' }));
    const e = erroObrigatoriedade(r);
    assert.equal(e.code, 'CAMPOS_OBRIGATORIOS_CATEGORIA');
    assert.equal(e.status, 422);
    assert.equal(e.pendencias.length, r.erros.length);
    assert.match(e.message, /Venda de mercadoria/);
});
