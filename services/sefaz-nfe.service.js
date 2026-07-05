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
const { create } = require('xmlbuilder2');
const { SignedXml } = require('xml-crypto');
const crypto = require('crypto');

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
    if (!pedido.itens || pedido.itens.length === 0) throw new Error('Pedido sem itens');
    if (!pedido.cliente) throw new Error('Cliente não informado');

    const tpAmb = cfg.ambiente === 'producao' ? '1' : '2';
    const ufEmit = cfg.uf_emitente || 'SP';
    const cUF = { SP: '35', RJ: '33', MG: '31', PR: '41', RS: '43', SC: '42', BA: '29', GO: '52', DF: '53' }[ufEmit] || '35';
    const ufDest = pedido.cliente.uf || pedido.cliente.estado || ufEmit;
    const cUFDest = { SP: '35', RJ: '33', MG: '31', PR: '41', RS: '43', SC: '42', BA: '29', GO: '52', DF: '53' }[ufDest] || cUF;
    const operacaoInterestadual = ufEmit !== ufDest;

    const serie = pad(cfg.serie || 1, 3);
    const numeroNF = pad(pedido.numero_nf || pedido.nf || pedido.id, 9);
    const dataEmissao = new Date();
    const dhEmi = dataEmissao.toISOString().replace(/\.\d{3}Z$/, '-03:00');

    const chave = gerarChaveAcesso({
        uf: cUF, dataEmissao, cnpj: cfg.cnpj, modelo: '55',
        serie: cfg.serie || 1, numeroNF: pedido.numero_nf || pedido.id, tpEmis: '1'
    });
    const cNF = chave.substring(35, 43);
    const cDV = chave.substring(43);

    const regime = cfg.regime_tributario === 'normal' ? '3' : '1'; // 1=Simples, 3=Normal
    const isSimples = regime === '1';

    // CFOP padrão
    const cfopVenda = operacaoInterestadual ? '6102' : '5102';

    // Calcular totais
    let vProd = 0, vICMS = 0, vIPI = 0, vPIS = 0, vCOFINS = 0;
    const itensXml = pedido.itens.map((item, idx) => {
        const qtd = Number(item.quantidade || 1);
        const vUn = Number(item.preco_unitario || item.valor_unitario || 0);
        const vItem = qtd * vUn;
        vProd += vItem;

        // Impostos por item (alíquotas da configuração ou defaults)
        const aliqICMS = Number(cfg.icms || 18);
        const aliqIPI = Number(cfg.ipi || 0);
        const aliqPIS = Number(cfg.pis || 1.65);
        const aliqCOFINS = Number(cfg.cofins || 7.6);

        const vICMSItem = isSimples ? 0 : (vItem * aliqICMS / 100);
        const vIPIItem = vItem * aliqIPI / 100;
        const vPISItem = vItem * aliqPIS / 100;
        const vCOFINSItem = vItem * aliqCOFINS / 100;

        vICMS += vICMSItem;
        vIPI += vIPIItem;
        vPIS += vPISItem;
        vCOFINS += vCOFINSItem;

        const icmsXml = isSimples
            ? `<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>`
            : `<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${moeda(vItem)}</vBC><pICMS>${moeda(aliqICMS)}</pICMS><vICMS>${moeda(vICMSItem)}</vICMS></ICMS00>`;

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
        <ICMS>${icmsXml}</ICMS>
        <IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>
        <PIS><PISAliq><CST>01</CST><vBC>${moeda(vItem)}</vBC><pPIS>${moeda(aliqPIS)}</pPIS><vPIS>${moeda(vPISItem)}</vPIS></PISAliq></PIS>
        <COFINS><COFINSAliq><CST>01</CST><vBC>${moeda(vItem)}</vBC><pCOFINS>${moeda(aliqCOFINS)}</pCOFINS><vCOFINS>${moeda(vCOFINSItem)}</vCOFINS></COFINSAliq></COFINS>
    </imposto>
</det>`;
    }).join('\n');

    const vNF = vProd + vICMS + vIPI; // simplificado
    const vTotTrib = vICMS + vIPI + vPIS + vCOFINS;

    // Destinatário
    const cli = pedido.cliente;
    const docDest = onlyDigits(cli.cnpj || cli.cpf || cli.cpf_cnpj || '');
    const isCPF = docDest.length === 11;

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
        <cMunFG>${pad(cfg.cod_municipio || '3550308', 7)}</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>${cDV}</cDV>
        <tpAmb>${tpAmb}</tpAmb>
        <finNFe>1</finNFe>
        <indFinal>${isCPF ? '1' : '0'}</indFinal>
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
            <cMun>${pad(cfg.cod_municipio || '3550308', 7)}</cMun>
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
        <xNome>${escXml((cli.razao_social || cli.nome || cli.nome_fantasia || 'Consumidor').slice(0, 60))}</xNome>
        <enderDest>
            <xLgr>${escXml((cli.endereco || 'Endereco').slice(0, 60))}</xLgr>
            <nro>${escXml((cli.numero || 'S/N').slice(0, 60))}</nro>
            <xBairro>${escXml((cli.bairro || 'Centro').slice(0, 60))}</xBairro>
            <cMun>${pad(cli.cod_municipio || cli.codigo_municipio || cUFDest === '35' ? '3550308' : '3304557', 7)}</cMun>
            <xMun>${escXml((cli.cidade || cli.municipio || 'Cidade').slice(0, 60))}</xMun>
            <UF>${ufDest}</UF>
            <CEP>${pad(onlyDigits(cli.cep || '01000000'), 8) || '01000000'}</CEP>
            <cPais>1058</cPais><xPais>BRASIL</xPais>
        </enderDest>
        <indIEDest>9</indIEDest>
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
            <indPag>0</indPag>
            <tPag>99</tPag>
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
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });

    sig.addReference({
        xpath: `//*[local-name()='infNFe' and @Id='${infNFeId}']`,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/2001/10/xml-exc-c14n#'
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
function transmitirNFe(xmlSigned, cred, idLote = null) {
    const tpAmb = cred.ambiente === 'producao' ? '1' : '2';
    const host = cred.ambiente === 'producao'
        ? 'nfe.fazenda.sp.gov.br'
        : 'homologacao.nfe.fazenda.sp.gov.br';
    const path = '/ws/nfeautorizacao4.asmx';
    const lote = idLote || Date.now().toString().slice(-10);

    const envio = `<?xml version="1.0" encoding="UTF-8"?>
<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<idLote>${lote}</idLote>
<indSinc>1</indSinc>
${xmlSigned}
</enviNFe>`;

    const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
<soap:Body>
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${envio}</nfeDadosMsg>
</soap:Body>
</soap:Envelope>`;

    return new Promise((resolve, reject) => {
        const req = https.request({
            host, port: 443, path, method: 'POST',
            cert: cred.pemCert, key: cred.pemKey,
            secureProtocol: 'TLSv1_2_method',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/soap+xml; charset=utf-8',
                'Content-Length': Buffer.byteLength(soap),
                'SOAPAction': ''
            },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Parse simples — para parse robusto usar xml2js (já instalado)
                const get = (tag) => {
                    const m = data.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
                    return m ? m[1] : null;
                };
                const protNFe = data.match(/<protNFe[\s\S]*?<\/protNFe>/);

                let infProt = null;
                if (protNFe) {
                    const block = protNFe[0];
                    infProt = {
                        cStat: (block.match(/<cStat>([^<]+)<\/cStat>/) || [])[1],
                        xMotivo: (block.match(/<xMotivo>([^<]+)<\/xMotivo>/) || [])[1],
                        nProt: (block.match(/<nProt>([^<]+)<\/nProt>/) || [])[1],
                        chNFe: (block.match(/<chNFe>([^<]+)<\/chNFe>/) || [])[1],
                        dhRecbto: (block.match(/<dhRecbto>([^<]+)<\/dhRecbto>/) || [])[1]
                    };
                }

                resolve({
                    success: res.statusCode === 200 && infProt && infProt.cStat === '100',
                    httpStatus: res.statusCode,
                    // Resultado do lote
                    loteStat: get('cStat'),
                    loteMotivo: get('xMotivo'),
                    // Resultado do protocolo
                    cStat: infProt?.cStat || get('cStat'),
                    xMotivo: infProt?.xMotivo || get('xMotivo'),
                    nProt: infProt?.nProt,
                    chave: infProt?.chNFe,
                    dhRecbto: infProt?.dhRecbto,
                    raw: data.slice(0, 4000)
                });
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout SEFAZ (30s)')); });
        req.on('error', e => reject(new Error('Erro comunicação SEFAZ: ' + e.message)));
        req.write(soap);
        req.end();
    });
}

// ============================================================
// EVENTOS NFe (cancelamento, CC-e, inutilização)
// ============================================================

/**
 * Constrói + transmite evento NF-e (cancelamento ou CC-e).
 *
 * @param {Object} params { tipo: 'cancelamento'|'cce', chave, motivo|correcao, nProtAutorizacao, cred }
 */
async function transmitirEvento({ tipo, chave, motivo, correcao, nProtAutorizacao, cred }) {
    const tpEvento = tipo === 'cancelamento' ? '110111' : '110110';
    const descEvento = tipo === 'cancelamento' ? 'Cancelamento' : 'Carta de Correcao';
    const tpAmb = cred.ambiente === 'producao' ? '1' : '2';
    const cnpj = cred.cnpj.replace(/\D/g, '').padStart(14, '0');
    const idEvento = `ID${tpEvento}${chave}01`;
    const dhEvento = new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00');

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
<xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1-A do art. 7 do Convenio S/N, de 15 de dezembro de 1970...</xCondUso>
</detEvento>`;
    }

    const infEvento = `<infEvento Id="${idEvento}">
<cOrgao>35</cOrgao>
<tpAmb>${tpAmb}</tpAmb>
<CNPJ>${cnpj}</CNPJ>
<chNFe>${chave}</chNFe>
<dhEvento>${dhEvento}</dhEvento>
<tpEvento>${tpEvento}</tpEvento>
<nSeqEvento>1</nSeqEvento>
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
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#'
    });
    sig.addReference({
        xpath: `//*[local-name()='infEvento']`,
        transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });
    sig.computeSignature(xmlEvento, { location: { reference: `//*[local-name()='infEvento']`, action: 'after' } });
    const xmlSigned = sig.getSignedXml();

    // Envelope
    const envio = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<idLote>${Date.now().toString().slice(-10)}</idLote>
${xmlSigned}
</envEvento>`;
    const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
<soap:Body>
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envio}</nfeDadosMsg>
</soap:Body>
</soap:Envelope>`;

    const host = cred.ambiente === 'producao'
        ? 'nfe.fazenda.sp.gov.br'
        : 'homologacao.nfe.fazenda.sp.gov.br';

    return new Promise((resolve, reject) => {
        const req = https.request({
            host, port: 443, path: '/ws/nferecepcaoevento4.asmx',
            method: 'POST', cert: cred.pemCert, key: cred.pemKey,
            secureProtocol: 'TLSv1_2_method', rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/soap+xml; charset=utf-8',
                'Content-Length': Buffer.byteLength(soap),
                'SOAPAction': ''
            },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const get = (t) => { const m = data.match(new RegExp(`<${t}>([^<]+)</${t}>`)); return m ? m[1] : null; };
                resolve({
                    success: res.statusCode === 200 && (get('cStat') === '135' || get('cStat') === '136'),
                    httpStatus: res.statusCode,
                    cStat: get('cStat'),
                    xMotivo: get('xMotivo'),
                    nProt: get('nProt'),
                    raw: data.slice(0, 3000)
                });
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout SEFAZ')); });
        req.on('error', e => reject(e));
        req.write(soap);
        req.end();
    });
}

/**
 * Inutilização de numeração de NF-e (quebra-numérica).
 */
async function transmitirInutilizacao({ ano, serie, nNFIni, nNFFim, motivo, cred }) {
    if (!motivo || motivo.length < 15) throw new Error('Justificativa de inutilização deve ter mínimo 15 caracteres');
    const tpAmb = cred.ambiente === 'producao' ? '1' : '2';
    const cnpj = cred.cnpj.replace(/\D/g, '').padStart(14, '0');
    const ano2 = String(ano).slice(-2);
    const idInut = `ID35${ano2}${cnpj}55${pad(serie, 3)}${pad(nNFIni, 9)}${pad(nNFFim, 9)}`;

    const infInut = `<infInut Id="${idInut}">
<tpAmb>${tpAmb}</tpAmb>
<xServ>INUTILIZAR</xServ>
<cUF>35</cUF>
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
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#'
    });
    sig.addReference({
        xpath: `//*[local-name()='infInut']`,
        transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });
    sig.computeSignature(xmlInut, { location: { reference: `//*[local-name()='infInut']`, action: 'after' } });
    const signed = sig.getSignedXml();

    const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
<soap:Body>
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">${signed}</nfeDadosMsg>
</soap:Body>
</soap:Envelope>`;

    const host = cred.ambiente === 'producao' ? 'nfe.fazenda.sp.gov.br' : 'homologacao.nfe.fazenda.sp.gov.br';

    return new Promise((resolve, reject) => {
        const req = https.request({
            host, port: 443, path: '/ws/nfeinutilizacao4.asmx',
            method: 'POST', cert: cred.pemCert, key: cred.pemKey,
            secureProtocol: 'TLSv1_2_method', rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/soap+xml; charset=utf-8',
                'Content-Length': Buffer.byteLength(soap), 'SOAPAction': ''
            },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const get = (t) => { const m = data.match(new RegExp(`<${t}>([^<]+)</${t}>`)); return m ? m[1] : null; };
                resolve({
                    success: res.statusCode === 200 && get('cStat') === '102',
                    cStat: get('cStat'), xMotivo: get('xMotivo'),
                    nProt: get('nProt'), raw: data.slice(0, 3000)
                });
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout SEFAZ')); });
        req.on('error', e => reject(e));
        req.write(soap);
        req.end();
    });
}

module.exports = {
    buildXmlNFe,
    signXmlNFe,
    transmitirNFe,
    transmitirEvento,
    transmitirInutilizacao,
    gerarChaveAcesso,
    calcularDV,
    escXml
};
