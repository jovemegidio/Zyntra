'use strict';

/**
 * Trava de obrigatoriedade por categoria de NF-e.
 *
 * Lê o XML que REALMENTE vai à SEFAZ (e não o que a tela diz que vai), descobre a
 * categoria da nota a partir dele e confere os campos que essa categoria é obrigada a
 * informar. A categoria é derivada do documento — quem emite não a escolhe nem a
 * declara —, então não dá para "trocar de categoria" para escapar de uma exigência.
 *
 * Só entram regras que a SEFAZ efetivamente aplica (ou que o XSD 4.00 exige): uma regra
 * inventada aqui bloquearia emissão legítima. Erros bloqueiam; avisos só informam.
 */

const { validarConsistenciaFiscalItens } = require('./nfe-cadastro-preflight');

const CATEGORIAS = Object.freeze({
    VENDA: { rotulo: 'Venda de mercadoria', impostos: ['ICMS', 'PIS', 'COFINS'] },
    DEVOLUCAO: { rotulo: 'Devolução', impostos: ['ICMS', 'PIS', 'COFINS'], exigeNfRef: true },
    REMESSA_INDUSTRIALIZACAO: { rotulo: 'Remessa para industrialização', impostos: ['ICMS', 'PIS', 'COFINS'], semPagamento: true },
    BONIFICACAO: { rotulo: 'Bonificação, doação ou brinde', impostos: ['ICMS', 'PIS', 'COFINS'], semPagamento: true },
    REMESSA_CONSERTO: { rotulo: 'Remessa para conserto', impostos: ['ICMS', 'PIS', 'COFINS'], semPagamento: true }
});

const CFOP_POR_CATEGORIA = Object.freeze({
    '5901': 'REMESSA_INDUSTRIALIZACAO', '6901': 'REMESSA_INDUSTRIALIZACAO',
    '5910': 'BONIFICACAO', '6910': 'BONIFICACAO',
    '5915': 'REMESSA_CONSERTO', '6915': 'REMESSA_CONSERTO'
});

// CST/CSOSN que carregam valores de imposto e quais tags cada um exige.
const ICMS_CST_CAMPOS = Object.freeze({
    '00': ['vBC', 'pICMS', 'vICMS'],
    '10': ['vBC', 'pICMS', 'vICMS', 'vBCST', 'pICMSST', 'vICMSST'],
    '20': ['pRedBC', 'vBC', 'pICMS', 'vICMS'],
    '30': ['vBCST', 'pICMSST', 'vICMSST'],
    '70': ['pRedBC', 'vBC', 'pICMS', 'vICMS', 'vBCST', 'pICMSST', 'vICMSST'],
    '90': ['vBC', 'pICMS', 'vICMS']
});
const ICMS_CSOSN_CAMPOS = Object.freeze({
    '101': ['pCredSN', 'vCredICMSSN'],
    '201': ['vBCST', 'pICMSST', 'vICMSST'], // pCredSN/vCredICMSSN são opcionais no XSD do 201
    '202': ['vBCST', 'pICMSST', 'vICMSST'],
    '203': ['vBCST', 'pICMSST', 'vICMSST']
});
const ROTULO_CAMPO = Object.freeze({
    vBC: 'base de cálculo do ICMS (vBC)', pICMS: 'alíquota do ICMS (pICMS)', vICMS: 'valor do ICMS (vICMS)',
    pRedBC: 'percentual de redução da base (pRedBC)', vBCST: 'base de cálculo do ICMS-ST (vBCST)',
    pICMSST: 'alíquota do ICMS-ST (pICMSST)', vICMSST: 'valor do ICMS-ST (vICMSST)',
    pCredSN: 'alíquota de crédito do Simples (pCredSN)', vCredICMSSN: 'valor de crédito do Simples (vCredICMSSN)'
});
const CST_ST = ['10', '30', '70'];
const CSOSN_ST = ['201', '202', '203'];

const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
const vazio = v => v == null || String(v).trim() === '';

// ── Leitura do XML ────────────────────────────────────────────────────────────
function filhos(node, nome) {
    return Array.from(node?.childNodes || []).filter(n => n.nodeType === 1 && n.localName === nome);
}
const filho = (node, nome) => filhos(node, nome)[0] || null;
const texto = (node, nome) => filho(node, nome)?.textContent?.trim() || '';
const primeiroFilhoElemento = node => Array.from(node?.childNodes || []).find(n => n.nodeType === 1) || null;

function extrairModeloDoXml(xml) {
    const { DOMParser } = require('@xmldom/xmldom');
    const doc = new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') throw new Error(msg); } })
        .parseFromString(String(xml), 'text/xml');
    const inf = Array.from(doc.getElementsByTagNameNS('*', 'infNFe'))[0];
    if (!inf) throw new Error('XML sem o grupo infNFe.');
    const ide = filho(inf, 'ide'), emit = filho(inf, 'emit'), dest = filho(inf, 'dest');
    const enderEmit = filho(emit, 'enderEmit'), enderDest = filho(dest, 'enderDest');
    const pag = filho(inf, 'pag');
    return {
        ide: {
            natOp: texto(ide, 'natOp'), tpNF: texto(ide, 'tpNF'), idDest: texto(ide, 'idDest'),
            finNFe: texto(ide, 'finNFe'), indFinal: texto(ide, 'indFinal'), indPres: texto(ide, 'indPres'),
            tpAmb: texto(ide, 'tpAmb'),
            nfRef: filhos(ide, 'NFref').map(n => digitos(texto(n, 'refNFe'))).filter(Boolean),
            temNfRef: filhos(ide, 'NFref').length > 0
        },
        emitente: {
            cnpj: digitos(texto(emit, 'CNPJ')), nome: texto(emit, 'xNome'), ie: texto(emit, 'IE'),
            crt: texto(emit, 'CRT'), uf: texto(enderEmit, 'UF')
        },
        destinatario: dest ? {
            documento: digitos(texto(dest, 'CNPJ') || texto(dest, 'CPF')), idEstrangeiro: texto(dest, 'idEstrangeiro'),
            nome: texto(dest, 'xNome'), ie: texto(dest, 'IE'), indIEDest: texto(dest, 'indIEDest'),
            logradouro: texto(enderDest, 'xLgr'), numero: texto(enderDest, 'nro'), bairro: texto(enderDest, 'xBairro'),
            codigoMunicipio: digitos(texto(enderDest, 'cMun')), municipio: texto(enderDest, 'xMun'),
            uf: texto(enderDest, 'UF'), cep: digitos(texto(enderDest, 'CEP'))
        } : null,
        itens: filhos(inf, 'det').map((det, i) => {
            const prod = filho(det, 'prod'), imposto = filho(det, 'imposto');
            const icmsGrupo = filho(imposto, 'ICMS');
            const icmsTag = primeiroFilhoElemento(icmsGrupo);
            const campos = {};
            Array.from(icmsTag?.childNodes || []).filter(n => n.nodeType === 1)
                .forEach(n => { campos[n.localName] = n.textContent.trim(); });
            const pisTag = primeiroFilhoElemento(filho(imposto, 'PIS'));
            const cofinsTag = primeiroFilhoElemento(filho(imposto, 'COFINS'));
            const ipiGrupo = filho(imposto, 'IPI');
            const ipiTrib = filho(ipiGrupo, 'IPITrib');
            const nItem = det.getAttribute ? det.getAttribute('nItem') : null;
            return {
                indice: Number(nItem) || i + 1,
                codigo: texto(prod, 'cProd'), descricao: texto(prod, 'xProd'), ncm: digitos(texto(prod, 'NCM')),
                cest: digitos(texto(prod, 'CEST')), cfop: digitos(texto(prod, 'CFOP')), unidade: texto(prod, 'uCom'),
                quantidade: Number(texto(prod, 'qCom')), valorUnitario: Number(texto(prod, 'vUnCom')),
                valorProduto: Number(texto(prod, 'vProd')), codigoBeneficioFiscal: texto(prod, 'cBenef'),
                icms: icmsTag ? { grupo: icmsTag.localName, orig: campos.orig || '', cst: campos.CST || '', csosn: campos.CSOSN || '', campos } : null,
                pis: pisTag ? { grupo: pisTag.localName, cst: texto(pisTag, 'CST') } : null,
                cofins: cofinsTag ? { grupo: cofinsTag.localName, cst: texto(cofinsTag, 'CST'), vBC: texto(cofinsTag, 'vBC'), pCOFINS: texto(cofinsTag, 'pCOFINS') } : null,
                pisDetalhe: pisTag ? { vBC: texto(pisTag, 'vBC'), pPIS: texto(pisTag, 'pPIS') } : null,
                ipi: ipiGrupo ? { cEnq: texto(ipiGrupo, 'cEnq'), tributado: !!ipiTrib, vBC: texto(ipiTrib, 'vBC'), pIPI: texto(ipiTrib, 'pIPI'), vIPI: texto(ipiTrib, 'vIPI') } : null
            };
        }),
        transporte: { modFrete: texto(filho(inf, 'transp'), 'modFrete') },
        pagamento: filhos(pag, 'detPag').map(d => ({ tPag: texto(d, 'tPag'), xPag: texto(d, 'xPag'), vPag: texto(d, 'vPag') })),
        temGrupoPag: !!pag
    };
}

// ── Categoria ────────────────────────────────────────────────────────────────
function classificarCategoria(modelo) {
    if (modelo.ide.finNFe === '4') return 'DEVOLUCAO';
    const cfops = [...new Set(modelo.itens.map(i => i.cfop).filter(Boolean))];
    const especiais = [...new Set(cfops.map(c => CFOP_POR_CATEGORIA[c]).filter(Boolean))];
    if (especiais.length === 1 && cfops.every(c => CFOP_POR_CATEGORIA[c] === especiais[0])) return especiais[0];
    return 'VENDA';
}

// ── Validação ────────────────────────────────────────────────────────────────
function validarModelo(modelo) {
    const categoria = classificarCategoria(modelo);
    const def = CATEGORIAS[categoria];
    const pendencias = [];
    const obrigatorio = (campo, mensagemExtra, item, extra = {}) => pendencias.push({
        codigo: 'CAMPO_OBRIGATORIO', severidade: 'erro', campo, item: item || null,
        mensagem: `Campo obrigatório para a categoria "${def.rotulo}": ${campo}${item ? ` (item ${item.indice} – ${item.codigo || item.descricao || 'sem código'})` : ''}.`
            + (mensagemExtra ? ` ${mensagemExtra}` : ''),
        ...extra
    });
    const incoerente = (campo, mensagem, item) => pendencias.push({
        codigo: 'CAMPO_INCOERENTE', severidade: 'erro', campo, item: item || null, mensagem
    });
    const aviso = (campo, mensagem, item) => pendencias.push({
        codigo: 'AVISO', severidade: 'aviso', campo, item: item || null, mensagem
    });

    const { ide, emitente, destinatario, itens } = modelo;

    // Cabeçalho
    if (vazio(ide.natOp)) obrigatorio('natureza da operação (natOp)');
    if (vazio(ide.indPres)) obrigatorio('indicador de presença do comprador (indPres)');
    if (def.exigeNfRef) {
        if (!ide.temNfRef) obrigatorio('chave da NF-e referenciada (refNFe)', 'Informe a chave de 44 dígitos da nota original.');
        else if (ide.nfRef.some(c => c.length !== 44)) incoerente('refNFe', 'A chave da NF-e referenciada deve possuir exatamente 44 dígitos.');
    }
    if (vazio(emitente.crt)) obrigatorio('regime tributário do emitente (CRT)');

    // Destinatário
    if (!destinatario) {
        obrigatorio('destinatário (dest)');
    } else {
        const exterior = destinatario.uf === 'EX';
        if (vazio(destinatario.nome)) obrigatorio('razão social / nome do destinatário');
        if (!destinatario.documento && !(exterior && destinatario.idEstrangeiro)) obrigatorio('CNPJ ou CPF do destinatário');
        if (vazio(destinatario.logradouro)) obrigatorio('logradouro do destinatário');
        if (vazio(destinatario.numero)) obrigatorio('número do endereço do destinatário');
        if (vazio(destinatario.bairro)) obrigatorio('bairro do destinatário');
        if (vazio(destinatario.municipio)) obrigatorio('município do destinatário');
        if (vazio(destinatario.uf)) obrigatorio('UF do destinatário');
        if (!exterior) {
            if (destinatario.codigoMunicipio.length !== 7) obrigatorio('código IBGE do município do destinatário (7 dígitos)');
            if (destinatario.cep.length !== 8) obrigatorio('CEP do destinatário (8 dígitos)');
        }
        if (vazio(destinatario.indIEDest)) obrigatorio('indicador de IE do destinatário (indIEDest)');
        else if (destinatario.indIEDest === '1' && vazio(destinatario.ie)) {
            obrigatorio('inscrição estadual do destinatário', 'Destinatário marcado como contribuinte do ICMS.');
        }
        // idDest coerente com as UFs — é a base do CFOP 5/6/7.
        if (destinatario.uf && emitente.uf) {
            const esperado = exterior ? '3' : (destinatario.uf === emitente.uf ? '1' : '2');
            if (ide.idDest && ide.idDest !== esperado) {
                incoerente('idDest', `Identificador de destino (idDest=${ide.idDest}) não confere com as UFs do emitente (${emitente.uf}) e do destinatário (${destinatario.uf}); o esperado é ${esperado}.`);
            }
        }
    }

    // Itens
    if (!itens.length) obrigatorio('ao menos um item (det)');
    for (const item of itens) {
        if (vazio(item.codigo)) obrigatorio('código do produto', null, item);
        if (vazio(item.descricao)) obrigatorio('descrição do produto', null, item);
        if (!item.ncm) obrigatorio('NCM', 'Cadastre o NCM no produto antes de emitir.', item);
        else if (![2, 8].includes(item.ncm.length)) incoerente('NCM', `NCM "${item.ncm}" inválido: deve ter 8 dígitos (item ${item.indice}).`, item);
        if (item.cfop.length !== 4) obrigatorio('CFOP (4 dígitos)', null, item);
        else {
            const primeiro = item.cfop[0];
            if (ide.tpNF === '1' && !['5', '6', '7'].includes(primeiro)) incoerente('CFOP', `CFOP ${item.cfop} é de entrada, mas a nota é de saída (item ${item.indice}).`, item);
            if (ide.tpNF === '0' && !['1', '2', '3'].includes(primeiro)) incoerente('CFOP', `CFOP ${item.cfop} é de saída, mas a nota é de entrada (item ${item.indice}).`, item);
            const alcance = { '1': '1', '5': '1', '2': '2', '6': '2', '3': '3', '7': '3' }[primeiro];
            if (ide.idDest && alcance && alcance !== ide.idDest) {
                incoerente('CFOP', `CFOP ${item.cfop} não confere com o destino da operação (idDest=${ide.idDest}) no item ${item.indice}: use ${ide.idDest === '1' ? '5xxx' : ide.idDest === '2' ? '6xxx' : '7xxx'}.`, item);
            }
        }
        if (vazio(item.unidade)) obrigatorio('unidade comercial', null, item);
        if (!(item.quantidade > 0)) obrigatorio('quantidade maior que zero', null, item);
        if (!Number.isFinite(item.valorUnitario) || item.valorUnitario < 0) obrigatorio('valor unitário', null, item);

        // ICMS
        const icms = item.icms;
        if (def.impostos.includes('ICMS') && !icms) {
            obrigatorio('ICMS (grupo de tributação)', 'A categoria exige a declaração do ICMS em todos os itens.', item);
        } else if (icms) {
            if (vazio(icms.orig)) obrigatorio('origem da mercadoria (orig)', null, item);
            const usaCsosn = !vazio(icms.csosn);
            const cst = icms.cst;
            if (emitente.crt === '1' && !usaCsosn) obrigatorio('CSOSN', 'Emitente do Simples Nacional (CRT 1) deve informar CSOSN, não CST.', item);
            if (emitente.crt === '3' && usaCsosn) obrigatorio('CST do ICMS', 'Emitente do regime normal (CRT 3) deve informar CST, não CSOSN.', item);
            if (!usaCsosn && vazio(cst)) obrigatorio('CST do ICMS', null, item);
            const exigidos = usaCsosn ? ICMS_CSOSN_CAMPOS[icms.csosn] : ICMS_CST_CAMPOS[String(cst).padStart(2, '0')];
            for (const tag of exigidos || []) {
                if (vazio(icms.campos[tag])) {
                    obrigatorio(ROTULO_CAMPO[tag], `Obrigatório para ${usaCsosn ? `CSOSN ${icms.csosn}` : `CST ${cst}`}.`, item);
                }
            }
            const temST = usaCsosn ? CSOSN_ST.includes(icms.csosn) : CST_ST.includes(String(cst).padStart(2, '0'));
            if (temST && item.cest.length !== 7) {
                obrigatorio('CEST (7 dígitos)', 'Item sujeito a ICMS-ST; o sistema não inventa o CEST — cadastre a classificação fiscal.', item);
            }
            if (!usaCsosn && ['00', '10', '20', '70', '90'].includes(String(cst).padStart(2, '0'))
                && !vazio(icms.campos.pICMS) && Number(icms.campos.pICMS) === 0) {
                aviso('pICMS', `Item ${item.indice}: CST ${cst} com alíquota de ICMS zerada — confirme se a tributação está correta.`, item);
            }
        }

        // PIS/COFINS
        for (const [nome, grupo] of [['PIS', item.pis], ['COFINS', item.cofins]]) {
            if (!def.impostos.includes(nome)) continue;
            if (!grupo) obrigatorio(`${nome} (grupo de tributação)`, 'A categoria exige a declaração do imposto em todos os itens.', item);
            else if (vazio(grupo.cst)) obrigatorio(`CST do ${nome}`, null, item);
        }
        if (item.pis && ['01', '02'].includes(item.pis.cst)) {
            if (vazio(item.pisDetalhe?.vBC)) obrigatorio('base de cálculo do PIS (vBC)', `Obrigatória para PIS CST ${item.pis.cst}.`, item);
            if (vazio(item.pisDetalhe?.pPIS)) obrigatorio('alíquota do PIS (pPIS)', `Obrigatória para PIS CST ${item.pis.cst}.`, item);
        }
        if (item.cofins && ['01', '02'].includes(item.cofins.cst)) {
            if (vazio(item.cofins.vBC)) obrigatorio('base de cálculo do COFINS (vBC)', `Obrigatória para COFINS CST ${item.cofins.cst}.`, item);
            if (vazio(item.cofins.pCOFINS)) obrigatorio('alíquota do COFINS (pCOFINS)', `Obrigatória para COFINS CST ${item.cofins.cst}.`, item);
        }
        if (item.ipi) {
            if (vazio(item.ipi.cEnq)) obrigatorio('código de enquadramento do IPI (cEnq)', null, item);
            if (item.ipi.tributado) {
                for (const [tag, rotulo] of [['vBC', 'base de cálculo do IPI'], ['pIPI', 'alíquota do IPI'], ['vIPI', 'valor do IPI']]) {
                    if (vazio(item.ipi[tag])) obrigatorio(`${rotulo} (${tag})`, 'Obrigatório para IPI tributado.', item);
                }
            }
        }
    }

    // Cobertura já existente de CST × cBenef (928/930/931) — mesma regra, mesma fonte.
    // Recebe cópias: o XML não é reescrito aqui, então nada é auto-corrigido em silêncio.
    const { problemas } = validarConsistenciaFiscalItens(itens.filter(i => i.icms && i.icms.cst).map(i => ({
        _index: i.indice, codigo: i.codigo, descricao: i.descricao, cst: i.icms.cst,
        codigoBeneficioFiscal: i.codigoBeneficioFiscal,
        percentualDiferimento: i.icms.campos.pDif, valorICMSDiferido: i.icms.campos.vICMSDif
    })));
    for (const p of problemas) incoerente('cBenef', p);

    // Transporte e pagamento
    if (vazio(modelo.transporte.modFrete)) obrigatorio('modalidade do frete (modFrete)');
    if (!modelo.temGrupoPag || !modelo.pagamento.length) obrigatorio('forma de pagamento (detPag)');
    modelo.pagamento.forEach(p => {
        if (vazio(p.tPag)) obrigatorio('meio de pagamento (tPag)');
        if (p.tPag === '99' && vazio(p.xPag)) obrigatorio('descrição do meio de pagamento (xPag)', 'Obrigatória quando o meio é "Outros" (99).');
        if (def.semPagamento && p.tPag && p.tPag !== '90') {
            aviso('tPag', `Categoria "${def.rotulo}" normalmente não tem pagamento; o meio de pagamento esperado é "90 – Sem pagamento".`);
        }
    });

    const erros = pendencias.filter(p => p.severidade === 'erro');
    return {
        categoria, rotulo: def.rotulo, ok: erros.length === 0,
        erros, avisos: pendencias.filter(p => p.severidade === 'aviso'),
        resumo: {
            ambiente: ide.tpAmb, cfops: [...new Set(itens.map(i => i.cfop))],
            destinatarioDocumento: destinatario?.documento || null, itens: itens.length
        }
    };
}

function validarXml(xml) {
    let modelo;
    try {
        modelo = extrairModeloDoXml(xml);
    } catch (e) {
        return {
            categoria: 'VENDA', rotulo: CATEGORIAS.VENDA.rotulo, ok: false, avisos: [],
            erros: [{ codigo: 'XML_ILEGIVEL', severidade: 'erro', campo: 'xml', mensagem: `XML da NF-e ilegível: ${e.message}` }],
            resumo: {}
        };
    }
    return validarModelo(modelo);
}

function erroObrigatoriedade(resultado) {
    const erro = new Error(`Emissão bloqueada — campos obrigatórios para a categoria "${resultado.rotulo}":\n`
        + resultado.erros.map(e => `• ${e.mensagem}`).join('\n'));
    erro.code = 'CAMPOS_OBRIGATORIOS_CATEGORIA';
    erro.status = 422;
    erro.categoria = resultado.categoria;
    erro.pendencias = resultado.erros;
    return erro;
}

module.exports = { CATEGORIAS, classificarCategoria, extrairModeloDoXml, validarModelo, validarXml, erroObrigatoriedade };
