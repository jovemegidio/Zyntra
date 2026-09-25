/**
 * Serviço SEFAZ NF-e — Geração de XML + Assinatura + Transmissão
 *
 * Implementa NT 2024.002 layout 4.00 para SEFAZ-SP.
 * Cobre o caminho feliz: emissão de NF-e modelo 55 venda interna/interestadual.
 *
 * ARQUITETURA:
 *   build(pedido, cfg)     → string XML NF-e válida + chave de acesso
 *   sign(xmlNFe, cred)     → string XML com bloco <Signature> embutido
 *   transmit(xmlAssinado)  → resultado SOAP nfeAutorizacao4 (síncrono)
 *
 * LIMITAÇÕES CONHECIDAS:
 *   - CFOP: assume CFOP padrão por destino (5102/6102). Para devolução,
 *     remessa, transferência, ajustar antes de transmitir.
 *   - CST ICMS: usa CST 00/40/41 baseado no regime tributário. Empresas
 *     do Simples Nacional usam CSOSN 101/102/500 (já tratado).
 *   - ICMS-ST e Difal: NÃO implementado. Requer parametrização adicional.
 *   - IPI/PIS/COFINS: usa CST 99 (outros) e alíquota da configuração.
 *
 * @module services/sefaz-nfe.service
 */

const forge = require('node-forge');
const https = require('https');
const { resolverCodigoMunicipioCliente } = require('../modules/Faturamento/services/fiscal-helpers');
const { create } = require('xmlbuilder2');
const { SignedXml } = require('xml-crypto');
const crypto = require('crypto');
const { chamarSefaz } = require('./sefaz-transport');
const { exigirXmlValido } = require('./nfe-schema-validator');

/**
 * Autorizadores da NF-e modelo 55 por UF. Só os estados com autorizador próprio
 * estão listados; os demais caem no SVAN/SVRS, que é o correto para a maioria.
 *
 * ⚠️ Antes desta correção o host era FIXO em São Paulo — emitir de qualquer outra
 * UF iria para o autorizador errado. As 3 instâncias são de SP, então o defeito
 * não aparecia, mas quebraria em qualquer expansão.
 */
const WS_NFE = {
    SP: { producao: 'https://nfe.fazenda.sp.gov.br/ws/', homologacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/' },
    PR: { producao: 'https://nfe.sefa.pr.gov.br/nfe/', homologacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/' },
    MG: { producao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/', homologacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/' },
    RS: { producao: 'https://nfe.svrs.rs.gov.br/ws/', homologacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/' },
    _SVRS: { producao: 'https://nfe.svrs.rs.gov.br/ws/', homologacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/' }
};

/**
 * Canonicalização da assinatura — C14N **INCLUSIVA**.
 *
 * AUDIT-FIX 18/07/2026: o código assinava com canonicalização EXCLUSIVA
 * ('http://www.w3.org/2001/10/xml-exc-c14n#'). O schema da NF-e 4.00 fixa o
 * valor de CanonicalizationMethod/@Algorithm em REC-xml-c14n-20010315 e só
 * aceita esse valor (ou enveloped-signature) em Transform/@Algorithm — qualquer
 * outro reprova na validação. Era a causa do
 *   cStat 225 "Rejeição: Falha no Schema XML do lote de NFe"
 * que aparecia em toda emissão. Confirmado com xmllint contra o XSD oficial.
 * Vale igualmente para NF-e 55 e NFC-e 65, que compartilham signXmlNFe().
 */
const C14N_NFE = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/**
 * Data/hora no formato da SEFAZ, com fuso REAL.
 *
 * AUDIT-FIX 18/07/2026: o código fazia
 *   new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00')
 * que pega a hora em UTC e apenas COLA o rótulo '-03:00' — a nota saía 3 horas
 * no futuro. A SEFAZ rejeitava com
 *   cStat 703 "Data-Hora de Emissão posterior ao horário de recebimento".
 * Aqui o instante é de fato convertido para o fuso antes de rotular.
 *
 * O Brasil não adota mais horário de verão desde 2019, então -03:00 é estável
 * para SP; instâncias em outro fuso devem passar `offsetHoras`.
 */
function dataHoraSefaz(quando = new Date(), offsetHoras = -3) {
    const deslocado = new Date(quando.getTime() + offsetHoras * 3600000);
    const sinal = offsetHoras < 0 ? '-' : '+';
    const hh = String(Math.abs(Math.trunc(offsetHoras))).padStart(2, '0');
    const mm = String(Math.round((Math.abs(offsetHoras) % 1) * 60)).padStart(2, '0');
    return deslocado.toISOString().replace(/\.\d{3}Z$/, `${sinal}${hh}:${mm}`);
}

/**
 * Código de Regime Tributário (CRT) da NF-e a partir do regime cadastrado.
 *   1 = Simples Nacional
 *   2 = Simples Nacional — excesso de sublimite de receita bruta
 *   3 = Regime Normal (lucro presumido / lucro real)
 *   4 = Simples Nacional — MEI
 * O CRT determina o grupo de ICMS usado no item: Simples usa CSOSN (ICMSSN*),
 * Regime Normal usa CST (ICMS00/40/...). Errar aqui gera nota com tributação errada.
 */
function crtDoRegime(regime) {
    const r = String(regime || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (r.includes('mei') || r.includes('microempreendedor')) return '4';
    if (r.includes('excesso') || r.includes('sublimite')) return '2';
    if (r.includes('simples')) return '1';
    if (r.includes('presumido') || r.includes('real') || r === 'normal' || r.includes('regime_normal')) return '3';
    // Desconhecido: assume Regime Normal, que é o conservador — emitir CSOSN
    // indevidamente para quem não é do Simples é erro mais grave que o inverso.
    console.warn('[SEFAZ] regime_tributario não reconhecido (%s) — assumindo CRT 3 (Regime Normal)', regime);
    return '3';
}

const COD_UF_NFE = {
    AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53', ES: '32',
    GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15', PB: '25', PR: '41',
    PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43', RO: '11', RR: '14', SC: '42',
    SP: '35', SE: '28', TO: '17'
};

/** Monta a URL do serviço NF-e conforme a UF e o ambiente das credenciais. */
function urlNFe(cred, servico) {
    const uf = String(cred.uf || cred.uf_emitente || 'SP').toUpperCase();
    const amb = cred.ambiente === 'producao' ? 'producao' : 'homologacao';
    const base = (WS_NFE[uf] || WS_NFE._SVRS)[amb];
    return base + servico;
}

// ============================================================
// HELPERS
// ============================================================

function pad(v, n, ch = '0') {
    return String(v == null ? '' : v).padStart(n, ch);
}

function onlyDigits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
}

function calcularDV(chave43) {
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;
    for (let i = chave43.length - 1, p = 0; i >= 0; i--, p++) {
        soma += parseInt(chave43[i], 10) * pesos[p % pesos.length];
    }
    const resto = soma % 11;
    const dv = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return String(dv);
}

function gerarChaveAcesso({ uf = '35', dataEmissao, cnpj, modelo = '55', serie, numeroNF, tpEmis = '1' }) {
    const dt = new Date(dataEmissao || Date.now());
    const aamm = String(dt.getFullYear()).slice(2) + pad(dt.getMonth() + 1, 2);
    const cnpjL = pad(onlyDigits(cnpj), 14).slice(-14);
    const mod = pad(modelo, 2);
    const ser = pad(serie, 3);
    const nNF = pad(numeroNF, 9);
    const cNF = pad(Math.floor(Math.random() * 1e8), 8);
    const chave43 = `${pad(uf, 2).slice(-2)}${aamm}${cnpjL}${mod}${ser}${nNF}${tpEmis}${cNF}`;
    return chave43 + calcularDV(chave43);
}

function moeda(v, casas = 2) {
    return (Number(v) || 0).toFixed(casas);
}

// ============================================================
// BUILD XML NFe
// ============================================================

/**
 * Constrói o XML NF-e a partir de um pedido e configurações.
 *
 * @param {Object} pedido          dados do pedido (com itens, cliente)
 * @param {Object} cfg             configurações fiscais (CNPJ emit, regime, etc.)
 * @returns {Object}               { xml, chave, infNFeId, numero, serie }
 */
function buildXmlNFe(pedido, cfg) {
    // Validações mínimas
    if (!cfg.cnpj) throw new Error('CNPJ do emitente não configurado');
    // AUDIT-FIX: antes havia fallback silencioso para 3550308 (capital de SP).
    // Emitir com o município errado é rejeição na SEFAZ e jurisdição tributária
    // incorreta — falhar aqui é melhor do que emitir errado.
    if (!cfg.cod_municipio) {
        throw new Error('Código IBGE do município do emitente não configurado (Configurações › Empresa)');
    }
    if (!pedido.itens || pedido.itens.length === 0) throw new Error('Pedido sem itens');
    if (!pedido.cliente) throw new Error('Cliente não informado');

    const tpAmb = cfg.ambiente === 'producao' ? '1' : '2';
    const ufEmit = cfg.uf_emitente || 'SP';
    const cUF = { SP: '35', RJ: '33', MG: '31', PR: '41', RS: '43', SC: '42', BA: '29', GO: '52', DF: '53' }[ufEmit] || '35';
    const ufDest = pedido.cliente.uf || pedido.cliente.estado || ufEmit;
    const operacaoInterestadual = ufEmit !== ufDest;

    const serie = pad(cfg.serie || 1, 3);
    const numeroNF = pad(pedido.numero_nf || pedido.nf || pedido.id, 9);
    const dataEmissao = new Date();
    const dhEmi = dataHoraSefaz(dataEmissao);

    const chave = gerarChaveAcesso({
        uf: cUF, dataEmissao, cnpj: cfg.cnpj, modelo: '55',
        serie: cfg.serie || 1, numeroNF: pedido.numero_nf || pedido.id, tpEmis: '1'
    });
    const cNF = chave.substring(35, 43);
    const cDV = chave.substring(43);

    // AUDIT-FIX 18/07/2026: era `regime_tributario === 'normal' ? '3' : '1'`, ou seja
    // TUDO que não fosse literalmente 'normal' virava Simples Nacional. A aluforce e a
    // labor-eletric são LUCRO PRESUMIDO e saíam com CRT=1, gerando CSOSN em vez de CST
    // e ICMS zerado — nota fiscalmente errada. O mapeamento agora é explícito.
    const regime = crtDoRegime(cfg.regime_tributario);
    const isSimples = regime === '1' || regime === '2' || regime === '4';

    // CFOP de fallback quando nem o item nem o produto informam.
    const cfopPadrao = operacaoInterestadual ? '6102' : '5102';

    // AUDIT-FIX 18/07/2026: o gerador IGNORAVA o cadastro fiscal. CFOP era fixo em
    // 5102/6102 e as alíquotas vinham de cfg (ou dos defaults 18/0/1,65/7,6),
    // mesmo com os 376 produtos tendo CFOP 5101, IPI 5%, PIS 0,65% e COFINS 3%
    // cadastrados. Resultado: operação classificada como revenda em vez de
    // produção própria, IPI não destacado e PIS/COFINS a maior.
    // Agora a precedência é: item do pedido → cadastro do produto → cfg → default.
    // AUDIT-FIX: a versão inicial aceitava 0 como "valor informado". Mas
    // pedido_itens.aliquota_icms e .aliquota_ipi têm DEFAULT 0.00 — o zero da
    // coluna sombreava a alíquota real do produto e a nota saía com ICMS e IPI
    // zerados mesmo em Regime Normal. Zero aqui significa "não preenchido" e
    // segue para o próximo candidato; alíquota legitimamente zero se expressa
    // por CST/CSOSN de isenção, não por 0% num CST tributado.
    // O último valor da lista é o default e vale mesmo sendo zero.
    const primeiro = (...vs) => {
        for (let i = 0; i < vs.length; i++) {
            const v = vs[i];
            if (v === null || v === undefined || v === '') continue;
            const n = Number(v);
            if (Number.isNaN(n)) continue;
            if (n === 0 && i < vs.length - 1) continue;   // zero = não preenchido
            return n;
        }
        return 0;
    };
    /** CFOP coerente com o sentido da operação (5xxx interna, 6xxx interestadual). */
    const cfopDoItem = (item) => {
        const desejado = operacaoInterestadual ? '6' : '5';
        const candidatos = [
            item.cfop,
            operacaoInterestadual ? item.cfop_saida_interestadual : item.cfop_saida_interna,
            operacaoInterestadual ? item.cfop_saida_interna : item.cfop_saida_interestadual
        ].map(v => onlyDigits(v)).filter(v => v.length === 4);
        // Prioriza um CFOP já no sentido correto; se só houver do outro sentido,
        // converte a família (5102 ⇄ 6102) em vez de descartar o cadastro.
        const noSentido = candidatos.find(v => v[0] === desejado);
        if (noSentido) return noSentido;
        if (candidatos.length) return desejado + candidatos[0].slice(1);
        return cfopPadrao;
    };

    // Calcular totais
    let vProd = 0, vICMS = 0, vIPI = 0, vPIS = 0, vCOFINS = 0;
    const itensXml = pedido.itens.map((item, idx) => {
        const qtd = Number(item.quantidade || 1);
        const vUn = Number(item.preco_unitario || item.valor_unitario || 0);
        const vItem = qtd * vUn;
        vProd += vItem;

        const cfopVenda = cfopDoItem(item);
        const aliqICMS = primeiro(item.aliquota_icms, item.icms_percent, item.pr_icms, cfg.icms, 18);
        // No Simples Nacional o IPI é recolhido no DAS e NÃO se destaca na nota.
        // AUDIT-FIX: sem esta condição, o zero cadastrado no produto era tratado
        // como "não preenchido" e caía no default da empresa (5%) — a Energy,
        // optante do Simples, emitiu com vIPI 15,00 e vNF inflado em 5%.
        const aliqIPI = isSimples ? 0 : primeiro(item.aliquota_ipi, item.pr_ipi, cfg.ipi, 0);
        const aliqPIS = primeiro(item.pis_percent, item.aliquota_pis, item.pr_pis, cfg.pis, 1.65);
        const aliqCOFINS = primeiro(item.cofins_percent, item.aliquota_cofins, item.pr_cofins, cfg.cofins, 7.6);
        const origem = onlyDigits(item.origem != null ? item.origem : '0').slice(0, 1) || '0';

        // No Simples, ICMS/PIS/COFINS não são destacados (recolhidos no DAS) —
        // os acumuladores precisam ficar zerados para que o ICMSTot bata com os itens.
        const vICMSItem = isSimples ? 0 : (vItem * aliqICMS / 100);
        const vIPIItem = vItem * aliqIPI / 100;
        const vPISItem = isSimples ? 0 : (vItem * aliqPIS / 100);
        const vCOFINSItem = isSimples ? 0 : (vItem * aliqCOFINS / 100);

        vICMS += vICMSItem;
        vIPI += vIPIItem;
        vPIS += vPISItem;
        vCOFINS += vCOFINSItem;

        // No Simples Nacional o PIS/COFINS é recolhido no DAS — não se destaca
        // alíquota na nota. CST 49 (outras operações) com valores zerados é o
        // tratamento correto. Antes saía PISAliq/COFINSAliq a 1,65%/7,6% para
        // TODAS as empresas, o que é indevido para optantes do Simples.
        const pisXml = isSimples
            ? `<PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr>`
            : `<PISAliq><CST>01</CST><vBC>${moeda(vItem)}</vBC><pPIS>${moeda(aliqPIS)}</pPIS><vPIS>${moeda(vPISItem)}</vPIS></PISAliq>`;
        const cofinsXml = isSimples
            ? `<COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr>`
            : `<COFINSAliq><CST>01</CST><vBC>${moeda(vItem)}</vBC><pCOFINS>${moeda(aliqCOFINS)}</pCOFINS><vCOFINS>${moeda(vCOFINSItem)}</vCOFINS></COFINSAliq>`;

        // ICMS conforme o cadastro: CSOSN no Simples, CST no Regime Normal.
        // 'orig' também passa a vir do produto em vez de zero fixo.
        const csosn = onlyDigits(item.csosn_icms || item.csosn || '') || '102';
        const cstIcms = pad(onlyDigits(item.cst_icms || item.cst || '') || (aliqICMS > 0 ? '00' : '40'), 2);
        const icmsXml = isSimples
            ? `<ICMSSN102><orig>${origem}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102>`
            : (cstIcms === '00'
                ? `<ICMS00><orig>${origem}</orig><CST>00</CST><modBC>3</modBC><vBC>${moeda(vItem)}</vBC><pICMS>${moeda(aliqICMS)}</pICMS><vICMS>${moeda(vICMSItem)}</vICMS></ICMS00>`
                : `<ICMS40><orig>${origem}</orig><CST>${cstIcms}</CST></ICMS40>`);

        // IPI: com alíquota cadastrada vira tributado (CST 50); sem, mantém
        // não-tributado. Antes o IPI dos produtos (5%) nunca era destacado.
        const ipiXml = aliqIPI > 0
            ? `<IPITrib><CST>50</CST><vBC>${moeda(vItem)}</vBC><pIPI>${moeda(aliqIPI)}</pIPI><vIPI>${moeda(vIPIItem)}</vIPI></IPITrib>`
            : `<IPINT><CST>53</CST></IPINT>`;

        return `<det nItem="${idx + 1}">
    <prod>
        <cProd>${(item.codigo_produto || item.codigo || `ITEM${idx + 1}`).slice(0, 60)}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${escXml((item.descricao || item.produto || 'Produto').slice(0, 120))}</xProd>
        <NCM>${pad(onlyDigits(item.ncm || cfg.ncm_padrao || '00000000'), 8).slice(-8)}</NCM>
        <CFOP>${cfopVenda}</CFOP>
        <uCom>${(item.unidade || 'UN').slice(0, 6)}</uCom>
        <qCom>${moeda(qtd, 4)}</qCom>
        <vUnCom>${moeda(vUn, 4)}</vUnCom>
        <vProd>${moeda(vItem)}</vProd>
        <cEANTrib>SEM GTIN</cEANTrib>
        <uTrib>${(item.unidade || 'UN').slice(0, 6)}</uTrib>
        <qTrib>${moeda(qtd, 4)}</qTrib>
        <vUnTrib>${moeda(vUn, 4)}</vUnTrib>
        <indTot>1</indTot>
    </prod>
    <imposto>
        <vTotTrib>${moeda(vICMSItem + vIPIItem + vPISItem + vCOFINSItem)}</vTotTrib>
        <ICMS>${icmsXml}</ICMS>
        <IPI><cEnq>999</cEnq>${ipiXml}</IPI>
        <PIS>${pisXml}</PIS>
        <COFINS>${cofinsXml}</COFINS>
    </imposto>
</det>`;
    }).join('\n');

    // AUDIT-FIX 18/07/2026: era `vNF = vProd + vICMS + vIPI`. O ICMS é imposto POR
    // DENTRO — já está embutido no preço do produto — e somá-lo inflava o total da
    // nota. A SEFAZ valida esse somatório (cStat 610 "Total da NF-e difere do
    // somatório dos valores"); não estourou nos testes porque o ICMS vinha zerado
    // pelo bug do regime, mas quebraria em qualquer emissão do Regime Normal.
    //
    // Fórmula do layout 4.00:
    //   vNF = vProd - vDesc - vICMSDeson + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vServ
    // Os campos não suportados aqui (frete, seguro, desconto, ST) são zero no XML,
    // então a soma abaixo é coerente com o que é declarado em ICMSTot.
    const vNF = vProd + vIPI;
    // Carga tributária aproximada (Lei 12.741/2012). AUDIT-FIX: este total era
    // declarado em ICMSTot sem que os ITENS declarassem <vTotTrib>, e a SEFAZ
    // valida a igualdade — rejeitava com cStat 685 "Total do Valor Aproximado dos
    // Tributos difere do somatório dos itens". Agora cada item declara o seu e
    // este total é exatamente a soma deles.
    const vTotTrib = vICMS + vIPI + vPIS + vCOFINS;

    // Destinatário
    const cli = pedido.cliente;
    const docDest = onlyDigits(cli.cnpj || cli.cpf || cli.cpf_cnpj || '');
    const isCPF = docDest.length === 11;
    const codigoMunicipioDest = resolverCodigoMunicipioCliente(cli);
    if (!codigoMunicipioDest) {
        throw new Error(`Código IBGE do município do cliente "${cli.razao_social || cli.nome || cli.nome_fantasia || 'não identificado'}" não configurado ou inválido`);
    }

    // AUDIT-FIX 18/07/2026: indIEDest era FIXO em 9 (não contribuinte) enquanto
    // indFinal variava por CPF/CNPJ. Um cliente CNPJ saía com indIEDest=9 e
    // indFinal=0, combinação que a SEFAZ recusa:
    //   cStat 696 "Operação com não contribuinte deve indicar operação com consumidor final"
    // Agora os dois derivam da inscrição estadual do destinatário e ficam coerentes.
    // AUDIT-FIX 18/07/2026: em homologação a SEFAZ EXIGE esta razão social fixa no
    // destinatário e rejeita qualquer outra com
    //   cStat 598 "NF-e emitida em ambiente de homologação com Razão Social do
    //   destinatário diferente de 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO...'"
    // O builder da NFC-e já tratava isso; o da NF-e 55 não, o que inviabilizava
    // qualquer teste com cliente real do cadastro.
    const xNomeDest = tpAmb === '2'
        ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
        : String(cli.razao_social || cli.nome || cli.nome_fantasia || 'Consumidor').slice(0, 60);

    // 08/09/2026: o indicador passou a ter os TRÊS valores do layout e sai do mesmo
    // helper usado pelo motor do Faturamento (modules/Faturamento/services/fiscal-helpers),
    // para os dois builders não divergirem: 1=contribuinte com IE, 2=contribuinte ISENTO
    // de inscrição, 9=não contribuinte. Antes só existia 1 ou 9, e o "2" era inalcançável.
    const { resolverIndicadorIE } = require('../modules/Faturamento/services/fiscal-helpers');
    const fiscalDest = resolverIndicadorIE({
        ie: cli.inscricao_estadual || cli.ie,
        contribuinteIcms: cli.fiscal_contribuinte_icms != null
            ? cli.fiscal_contribuinte_icms
            : (cli.contribuinte_icms != null ? cli.contribuinte_icms : null)
    });
    const indIEDest = fiscalDest.indicadorIE;
    const ieDest = fiscalDest.ie || '';
    // Só o indicador 1 leva a tag <IE>; 2 e 9 são emitidos sem ela.
    const contribuinte = indIEDest === '1';
    // Não contribuinte ⇒ consumidor final (cStat 696). O isento de inscrição (2) é
    // contribuinte e segue indFinal=0, como o indicador 1.
    const indFinal = indIEDest === '9' ? '1' : '0';

    // Forma de pagamento. AUDIT-FIX: tPag era fixo em '99' (outros) SEM <xPag>, e a
    // SEFAZ recusa com cStat 441 "Descrição do pagamento obrigatória para meio de
    // pagamento 99-outros". Agora o pedido pode informar o meio; quando cair em 99,
    // a descrição vai junto.
    const tPag = pad(String(pedido.forma_pagamento_codigo || pedido.tipo_pagamento || '99'), 2);
    const indPag = String(pedido.indicador_pagamento != null ? pedido.indicador_pagamento : '0');
    const xPag = String(pedido.forma_pagamento_descricao || pedido.forma_pagamento || 'Outros').slice(0, 60);

    const xmlNFe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe Id="NFe${chave}" versao="4.00">
    <ide>
        <cUF>${cUF}</cUF>
        <cNF>${cNF}</cNF>
        <natOp>${escXml(cfg.natureza_operacao || 'Venda de mercadoria')}</natOp>
        <mod>55</mod>
        <serie>${parseInt(serie, 10)}</serie>
        <nNF>${parseInt(numeroNF, 10)}</nNF>
        <dhEmi>${dhEmi}</dhEmi>
        <tpNF>1</tpNF>
        <idDest>${operacaoInterestadual ? '2' : '1'}</idDest>
        <cMunFG>${pad(cfg.cod_municipio, 7)}</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>${cDV}</cDV>
        <tpAmb>${tpAmb}</tpAmb>
        <finNFe>1</finNFe>
        <indFinal>${indFinal}</indFinal>
        <indPres>1</indPres>
        <procEmi>0</procEmi>
        <verProc>Zyntra-1.0</verProc>
    </ide>
    <emit>
        <CNPJ>${pad(onlyDigits(cfg.cnpj), 14)}</CNPJ>
        <xNome>${escXml((cfg.razao_social || 'EMITENTE').slice(0, 60))}</xNome>
        ${cfg.nome_fantasia ? `<xFant>${escXml(cfg.nome_fantasia.slice(0, 60))}</xFant>` : ''}
        <enderEmit>
            <xLgr>${escXml((cfg.endereco || 'Endereco').slice(0, 60))}</xLgr>
            <nro>${escXml((cfg.numero || 'S/N').slice(0, 60))}</nro>
            <xBairro>${escXml((cfg.bairro || 'Centro').slice(0, 60))}</xBairro>
            <cMun>${pad(cfg.cod_municipio, 7)}</cMun>
            <xMun>${escXml((cfg.cidade || 'Sao Paulo').slice(0, 60))}</xMun>
            <UF>${ufEmit}</UF>
            <CEP>${pad(onlyDigits(cfg.cep || '01000000'), 8)}</CEP>
            <cPais>1058</cPais><xPais>BRASIL</xPais>
        </enderEmit>
        <IE>${onlyDigits(cfg.inscricao_estadual || 'ISENTO') || 'ISENTO'}</IE>
        <CRT>${regime}</CRT>
    </emit>
    <dest>
        ${docDest && isCPF ? `<CPF>${docDest}</CPF>` : (docDest ? `<CNPJ>${pad(docDest, 14)}</CNPJ>` : '<idEstrangeiro></idEstrangeiro>')}
        <xNome>${escXml(xNomeDest)}</xNome>
        <enderDest>
            <xLgr>${escXml((cli.endereco || 'Endereco').slice(0, 60))}</xLgr>
            <nro>${escXml((cli.numero || 'S/N').slice(0, 60))}</nro>
            <xBairro>${escXml((cli.bairro || 'Centro').slice(0, 60))}</xBairro>
            <cMun>${codigoMunicipioDest}</cMun>
            <xMun>${escXml((cli.cidade || cli.municipio || 'Cidade').slice(0, 60))}</xMun>
            <UF>${ufDest}</UF>
            <CEP>${pad(onlyDigits(cli.cep || '01000000'), 8) || '01000000'}</CEP>
            <cPais>1058</cPais><xPais>BRASIL</xPais>
        </enderDest>
        <indIEDest>${indIEDest}</indIEDest>${contribuinte ? `
        <IE>${escXml(ieDest)}</IE>` : ''}
        ${cli.email ? `<email>${escXml(cli.email.slice(0, 60))}</email>` : ''}
    </dest>
    ${itensXml}
    <total>
        <ICMSTot>
            <vBC>${moeda(isSimples ? 0 : vProd)}</vBC>
            <vICMS>${moeda(vICMS)}</vICMS>
            <vICMSDeson>0.00</vICMSDeson>
            <vFCP>0.00</vFCP>
            <vBCST>0.00</vBCST>
            <vST>0.00</vST>
            <vFCPST>0.00</vFCPST>
            <vFCPSTRet>0.00</vFCPSTRet>
            <vProd>${moeda(vProd)}</vProd>
            <vFrete>0.00</vFrete>
            <vSeg>0.00</vSeg>
            <vDesc>0.00</vDesc>
            <vII>0.00</vII>
            <vIPI>${moeda(vIPI)}</vIPI>
            <vIPIDevol>0.00</vIPIDevol>
            <vPIS>${moeda(vPIS)}</vPIS>
            <vCOFINS>${moeda(vCOFINS)}</vCOFINS>
            <vOutro>0.00</vOutro>
            <vNF>${moeda(vNF)}</vNF>
            <vTotTrib>${moeda(vTotTrib)}</vTotTrib>
        </ICMSTot>
    </total>
    <transp><modFrete>9</modFrete></transp>
    <pag>
        <detPag>
            <indPag>${escXml(indPag)}</indPag>
            <tPag>${escXml(tPag)}</tPag>${tPag === '99' ? `
            <xPag>${escXml(xPag)}</xPag>` : ''}
            <vPag>${moeda(vNF)}</vPag>
        </detPag>
    </pag>
    <infAdic>
        <infCpl>Documento emitido por Zyntra ERP. Pedido #${pedido.id}.</infCpl>
    </infAdic>
</infNFe>
</NFe>`;

    return {
        xml: xmlNFe.replace(/>\s+</g, '><').trim(),
        chave,
        infNFeId: `NFe${chave}`,
        numero: pedido.numero_nf || pedido.id,
        serie: cfg.serie || 1,
        ambiente: tpAmb
    };
}

function escXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
        // Remove caracteres não permitidos em XML 1.0
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ============================================================
// SIGN XML
// ============================================================

/**
 * Assina o XML NF-e usando RSA-SHA1 e canonicalização exclusiva (c14n).
 *
 * @param {string} xmlNFe   XML sem assinatura (output do buildXmlNFe.xml)
 * @param {string} infNFeId valor do atributo Id (output do buildXmlNFe.infNFeId)
 * @param {Object} cred     { pemCert, pemKey } (output do loadCertFromDb)
 * @returns {string}        XML completo com bloco <Signature> dentro de <NFe>
 */
function signXmlNFe(xmlNFe, infNFeId, cred) {
    const sig = new SignedXml({
        privateKey: cred.pemKey,
        publicCert: cred.pemCert,
        signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
        canonicalizationAlgorithm: C14N_NFE,
    });

    sig.addReference({
        xpath: `//*[local-name()='infNFe' and @Id='${infNFeId}']`,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            C14N_NFE
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });

    sig.computeSignature(xmlNFe, {
        location: { reference: `//*[local-name()='infNFe']`, action: 'after' }
    });

    return sig.getSignedXml();
}

// ============================================================
// TRANSMIT NFe to SEFAZ (synchronous)
// ============================================================

/**
 * Transmite o XML assinado para nfeAutorizacao4 (modo síncrono).
 *
 * @param {string} xmlSigned     output do signXmlNFe()
 * @param {Object} cred          { pemCert, pemKey, ambiente }
 * @param {string} idLote        idLote (default = timestamp)
 * @returns {Promise<Object>}    { cStat, xMotivo, nProt, chave, dhRecbto, raw }
 */
async function transmitirNFe(xmlSigned, cred, idLote = null) {
    await require('./nfe-cadastro-preflight').validarAntesTransmissao(xmlSigned, cred);
    const lote = idLote || Date.now().toString().slice(-10);
    const envio = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
        + `<idLote>${lote}</idLote><indSinc>1</indSinc>${xmlSigned}</enviNFe>`;

    // Valida contra o XSD antes de gastar a viagem: a SEFAZ devolveria apenas
    // cStat 225 genérico, enquanto aqui o erro vem com elemento e atributo.
    await exigirXmlValido(envio, 'enviNFe');

    let data;
    try {
        data = await chamarSefaz(urlNFe(cred, 'nfeautorizacao4.asmx'), cred, 'nfeAutorizacaoLote', envio);
    } catch (e) {
        throw new Error('Erro comunicação SEFAZ: ' + e.message);
    }

    const get = (tag) => { const m = data.match(new RegExp(`<${tag}>([^<]+)</${tag}>`)); return m ? m[1] : null; };
    const protNFe = data.match(/<protNFe[\s\S]*?<\/protNFe>/);

    let infProt = null;
    if (protNFe) {
        const block = protNFe[0];
        const g = (t) => (block.match(new RegExp(`<${t}>([^<]+)</${t}>`)) || [])[1];
        infProt = { cStat: g('cStat'), xMotivo: g('xMotivo'), nProt: g('nProt'), chNFe: g('chNFe'), dhRecbto: g('dhRecbto') };
    }

    return {
        success: !!(infProt && infProt.cStat === '100'),
        httpStatus: 200,
        loteStat: get('cStat'),
        loteMotivo: get('xMotivo'),
        cStat: (infProt && infProt.cStat) || get('cStat'),
        xMotivo: (infProt && infProt.xMotivo) || get('xMotivo'),
        nProt: infProt && infProt.nProt,
        chave: infProt && infProt.chNFe,
        dhRecbto: infProt && infProt.dhRecbto,
        raw: data.slice(0, 4000)
    };
}

// ============================================================
// EVENTOS NFe (cancelamento, CC-e, inutilização)
// ============================================================

/**
 * Texto da condição de uso da CC-e. É PRESCRITO em lei e a SEFAZ compara caractere a caractere —
 * aqui ele estava cortado com reticências ("...de 15 de dezembro de 1970..."), o que fazia toda
 * Carta de Correção emitida por este caminho ser recusada. Precisa continuar idêntico ao de
 * `modules/Faturamento/services/sefaz.service.js`; há teste garantindo que os dois não divirjam.
 */
const XCOND_USO_CCE = 'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do '
    + 'Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro '
    + 'ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: '
    + 'I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, '
    + 'diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de '
    + 'dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de '
    + 'emissao ou de saida.';

/**
 * Constrói + transmite evento NF-e (cancelamento ou CC-e).
 *
 * @param {Object} params { tipo: 'cancelamento'|'cce', chave, motivo|correcao, nProtAutorizacao,
 *                          cred, sequencia }
 */
async function transmitirEvento({ tipo, chave, motivo, correcao, nProtAutorizacao, cred, sequencia = 1 }) {
    const tpEvento = tipo === 'cancelamento' ? '110111' : '110110';
    const descEvento = tipo === 'cancelamento' ? 'Cancelamento' : 'Carta de Correcao';
    const tpAmb = cred.ambiente === 'producao' ? '1' : '2';
    const cnpj = cred.cnpj.replace(/\D/g, '').padStart(14, '0');
    // nSeqEvento estava fixo em 1 (e o Id sempre terminando em "01"): a NF-e aceita até 20
    // CC-e, mas a SEGUNDA saía com a mesma sequência da primeira e a SEFAZ recusava por
    // duplicidade de evento. Cancelamento continua sempre em 1, que é o correto para ele.
    const nSeq = Math.max(1, parseInt(sequencia, 10) || 1);
    const idEvento = `ID${tpEvento}${chave}${String(nSeq).padStart(2, '0')}`;
    const dhEvento = dataHoraSefaz();

    let detEvento;
    if (tipo === 'cancelamento') {
        if (!motivo || motivo.length < 15) throw new Error('Motivo de cancelamento deve ter no mínimo 15 caracteres');
        detEvento = `<detEvento versao="1.00">
<descEvento>Cancelamento</descEvento>
<nProt>${nProtAutorizacao}</nProt>
<xJust>${escXml(motivo)}</xJust>
</detEvento>`;
    } else {
        if (!correcao || correcao.length < 15) throw new Error('Correção deve ter no mínimo 15 caracteres');
        detEvento = `<detEvento versao="1.00">
<descEvento>Carta de Correcao</descEvento>
<xCorrecao>${escXml(correcao)}</xCorrecao>
<xCondUso>${XCOND_USO_CCE}</xCondUso>
</detEvento>`;
    }

    // cOrgao é o código da UF do emitente. Estava fixo em 35 (SP): nota de qualquer outra UF
    // levaria o órgão errado. Os 2 primeiros dígitos da chave de acesso são exatamente esse
    // código, então ele sai do próprio documento.
    const cOrgao = String(chave).slice(0, 2) || '35';

    const infEvento = `<infEvento Id="${idEvento}">
<cOrgao>${cOrgao}</cOrgao>
<tpAmb>${tpAmb}</tpAmb>
<CNPJ>${cnpj}</CNPJ>
<chNFe>${chave}</chNFe>
<dhEvento>${dhEvento}</dhEvento>
<tpEvento>${tpEvento}</tpEvento>
<nSeqEvento>${nSeq}</nSeqEvento>
<verEvento>1.00</verEvento>
${detEvento}
</infEvento>`;

    const xmlEvento = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
${infEvento}
</evento>`;

    // Assinar
    const sig = new SignedXml({
        privateKey: cred.pemKey, publicCert: cred.pemCert,
        signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
        canonicalizationAlgorithm: C14N_NFE
    });
    sig.addReference({
        xpath: `//*[local-name()='infEvento']`,
        transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', C14N_NFE],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });
    sig.computeSignature(xmlEvento, { location: { reference: `//*[local-name()='infEvento']`, action: 'after' } });
    const xmlSigned = sig.getSignedXml();

    // Envelope
    const envio = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<idLote>${Date.now().toString().slice(-10)}</idLote>
${xmlSigned}
</envEvento>`;
    await exigirXmlValido(envio, 'envEvento');
    const data = await chamarSefaz(urlNFe(cred, 'nferecepcaoevento4.asmx'), cred, 'nfeRecepcaoEvento', envio);
    const get = (t) => { const m = data.match(new RegExp(`<${t}>([^<]+)</${t}>`)); return m ? m[1] : null; };
    return {
        // 135 = evento registrado | 136 = registrado e vinculado à NF-e
        success: get('cStat') === '135' || get('cStat') === '136',
        httpStatus: 200,
        cStat: get('cStat'),
        xMotivo: get('xMotivo'),
        nProt: get('nProt'),
        raw: data.slice(0, 3000)
    };
}

/**
 * Inutilização de numeração de NF-e (quebra-numérica).
 */
async function transmitirInutilizacao({ ano, serie, nNFIni, nNFFim, motivo, cred }) {
    if (!motivo || motivo.length < 15) throw new Error('Justificativa de inutilização deve ter mínimo 15 caracteres');
    const tpAmb = cred.ambiente === 'producao' ? '1' : '2';
    if (!cred.cnpj) throw new Error('CNPJ do emitente não informado nas credenciais');
    const cnpj = String(cred.cnpj).replace(/\D/g, '').padStart(14, '0');
    const ano2 = String(ano).slice(-2);
    // AUDIT-FIX: cUF e o prefixo do Id eram fixos em 35 (São Paulo). Inutilizar de
    // outra UF geraria um Id inválido e seria rejeitado. Agora acompanha cred.uf.
    const cUF = COD_UF_NFE[String(cred.uf || cred.uf_emitente || 'SP').toUpperCase()] || '35';
    const idInut = `ID${cUF}${ano2}${cnpj}55${pad(serie, 3)}${pad(nNFIni, 9)}${pad(nNFFim, 9)}`;

    const infInut = `<infInut Id="${idInut}">
<tpAmb>${tpAmb}</tpAmb>
<xServ>INUTILIZAR</xServ>
<cUF>${cUF}</cUF>
<ano>${ano2}</ano>
<CNPJ>${cnpj}</CNPJ>
<mod>55</mod>
<serie>${serie}</serie>
<nNFIni>${nNFIni}</nNFIni>
<nNFFim>${nNFFim}</nNFFim>
<xJust>${escXml(motivo)}</xJust>
</infInut>`;
    const xmlInut = `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${infInut}</inutNFe>`;

    const sig = new SignedXml({
        privateKey: cred.pemKey, publicCert: cred.pemCert,
        signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
        canonicalizationAlgorithm: C14N_NFE
    });
    sig.addReference({
        xpath: `//*[local-name()='infInut']`,
        transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', C14N_NFE],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });
    sig.computeSignature(xmlInut, { location: { reference: `//*[local-name()='infInut']`, action: 'after' } });
    const signed = sig.getSignedXml();

    await exigirXmlValido(signed, 'inutNFe');
    const data = await chamarSefaz(urlNFe(cred, 'nfeinutilizacao4.asmx'), cred, 'nfeInutilizacaoNF', signed);
    const get = (t) => { const m = data.match(new RegExp(`<${t}>([^<]+)</${t}>`)); return m ? m[1] : null; };
    return {
        success: get('cStat') === '102',   // 102 = inutilização homologada
        cStat: get('cStat'), xMotivo: get('xMotivo'),
        nProt: get('nProt'), raw: data.slice(0, 3000)
    };
}

module.exports = {
    buildXmlNFe,
    signXmlNFe,
    transmitirNFe,
    transmitirEvento,
    transmitirInutilizacao,
    gerarChaveAcesso,
    calcularDV,
    escXml,
    dataHoraSefaz,
    XCOND_USO_CCE
};
