/**
 * Serviço SEFAZ — comunicação direta com WebServices SEFAZ
 *
 * Lê certificado A1 e configurações fiscais (espelho de NF) das tabelas:
 *   - empresa_config       cert (path + senha), CNPJ, IE, endereço, códigos
 *                          (codigo_municipio, codigo_uf), serie/numero, ambiente
 *   - config_fiscal_empresa CFOPs (estado, fora estado, exportação) e
 *                          alíquotas padrão (ICMS, IPI, PIS, COFINS, ISS)
 *
 * @module services/sefaz.service
 */

const fs = require('fs');
const forge = require('node-forge');
const https = require('https');

/**
 * Carrega o espelho fiscal completo (empresa_config + config_fiscal_empresa)
 * e retorna um objeto unificado para uso pelo gerador de XML.
 */
async function loadEspelhoFiscal(pool, empresaId = 1) {
    // 1. empresa_config (cert path, dados cadastrais, códigos IBGE, série NFe)
    const [[emp]] = await pool.query(
        'SELECT * FROM empresa_config WHERE id = ? OR id = 1 ORDER BY (id = ?) DESC LIMIT 1',
        [empresaId, empresaId]
    ).catch(() => [[]]);

    // 2. config_fiscal_empresa (CFOPs + alíquotas)
    const [[fis]] = await pool.query(
        'SELECT * FROM config_fiscal_empresa WHERE empresa_id = ? OR empresa_id = 1 ORDER BY (empresa_id = ?) DESC LIMIT 1',
        [empresaId, empresaId]
    ).catch(() => [[]]);

    // 3. Fallback para configuracoes_empresa (legado)
    const [[empLegado]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1').catch(() => [[]]);

    return {
        // Identificação
        razao_social: emp?.razao_social || empLegado?.razao_social,
        nome_fantasia: emp?.nome_fantasia || empLegado?.nome_fantasia,
        cnpj: emp?.cnpj || empLegado?.cnpj,
        inscricao_estadual: emp?.inscricao_estadual || empLegado?.inscricao_estadual,
        inscricao_municipal: emp?.inscricao_municipal || empLegado?.inscricao_municipal,

        // Endereço
        endereco: emp?.endereco || empLegado?.endereco,
        numero: emp?.numero || empLegado?.numero,
        complemento: emp?.complemento || empLegado?.complemento,
        bairro: emp?.bairro || empLegado?.bairro,
        cidade: emp?.cidade || empLegado?.cidade,
        estado: emp?.estado || empLegado?.estado,
        uf_emitente: emp?.estado || empLegado?.estado || fis?.uf_empresa || 'SP',
        cep: emp?.cep || empLegado?.cep,

        // Códigos IBGE (essenciais para NFe)
        codigo_municipio: emp?.codigo_municipio || '3550308', // default São Paulo
        codigo_uf: emp?.codigo_uf || '35',

        // Regime tributário
        regime_tributario: emp?.regime_tributario || fis?.regime_tributario || 'simples',
        crt: emp?.crt || (emp?.regime_tributario === 'simples' ? 1 : 3),

        // Cert A1 (path em vez de BLOB)
        certificado_a1_path: emp?.certificado_a1_path,
        certificado_senha: emp?.certificado_senha,
        certificado_validade: emp?.certificado_validade,

        // NFe config
        ambiente: emp?.nfe_ambiente == 1 ? 'producao' : 'homologacao',
        serie: emp?.nfe_serie || 1,
        proximo_numero: emp?.nfe_proximo_numero || 1,

        // CFOPs (espelho)
        cfop_estado: fis?.cfop_venda_estado || '5102',
        cfop_fora_estado: fis?.cfop_venda_fora_estado || '6102',
        cfop_exportacao: fis?.cfop_exportacao || '7101',

        // Alíquotas (espelho)
        icms: parseFloat(fis?.icms_padrao || 18),
        ipi: parseFloat(fis?.ipi_padrao || 0),
        pis: parseFloat(fis?.pis_padrao || 1.65),
        cofins: parseFloat(fis?.cofins_padrao || 7.6),
        iss: parseFloat(fis?.iss_padrao || 5),
        calcula_icms: fis?.calcula_icms != null ? !!fis.calcula_icms : true,
        calcula_ipi: fis?.calcula_ipi != null ? !!fis.calcula_ipi : false,
        calcula_pis_cofins: fis?.calcula_pis_cofins != null ? !!fis.calcula_pis_cofins : true,

        natureza_operacao: 'Venda de mercadoria',
        ncm_padrao: '00000000'
    };
}

/**
 * Carrega cert + chave do PFX armazenado em arquivo.
 * Suporta os dois locais:
 *   1. empresa_config.certificado_a1_path  (preferido — atual)
 *   2. nfe_configuracoes.certificado_pfx   (legado — BLOB)
 *
 * Valida que o CNPJ do certificado bate com o CNPJ do emitente.
 */
async function loadCertFromDb(pool, empresaId = 1) {
    const espelho = await loadEspelhoFiscal(pool, empresaId);

    let pfxBuffer = null;
    let senha = null;

    // Tentativa 1: arquivo via empresa_config.certificado_a1_path
    if (espelho.certificado_a1_path && fs.existsSync(espelho.certificado_a1_path)) {
        try {
            pfxBuffer = fs.readFileSync(espelho.certificado_a1_path);
            senha = espelho.certificado_senha || '';
        } catch (e) {
            console.warn('[SEFAZ] Falha ler PFX do path:', e.message);
        }
    }

    // Tentativa 2: BLOB legado em nfe_configuracoes
    if (!pfxBuffer) {
        try {
            const [[row]] = await pool.query(
                `SELECT certificado_pfx, certificado_senha FROM nfe_configuracoes
                 WHERE empresa_id = ? AND certificado_pfx IS NOT NULL LIMIT 1`,
                [empresaId]
            );
            if (row && row.certificado_pfx) {
                pfxBuffer = row.certificado_pfx;
                // Senha aqui é base64 (formato do upload anterior)
                senha = Buffer.from(row.certificado_senha || '', 'base64').toString('utf8');
            }
        } catch (_) {}
    }

    if (!pfxBuffer) {
        throw new Error('Certificado digital não configurado. Faça upload em Configurações → Certificado Digital.');
    }
    if (!senha) {
        throw new Error('Senha do certificado não configurada.');
    }

    // Validade
    if (espelho.certificado_validade) {
        const venc = new Date(espelho.certificado_validade);
        if (venc < new Date()) {
            throw new Error('Certificado A1 expirado em ' + venc.toLocaleDateString('pt-BR'));
        }
    }

    // Parse PFX
    let p12, cert, key;
    try {
        const pfxDer = forge.util.decode64(pfxBuffer.toString('base64'));
        const pfxAsn1 = forge.asn1.fromDer(pfxDer);
        p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senha);
        cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
        key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
    } catch (e) {
        if (e.message && e.message.includes('Invalid password')) {
            throw new Error('Senha do certificado incorreta');
        }
        throw new Error('Erro ao ler certificado: ' + e.message);
    }

    if (!cert || !key) {
        throw new Error('PFX inválido: cert/chave não extraídos');
    }

    // Extrair CNPJ do CN do cert
    const cn = cert.subject.getField('CN');
    const cnValue = cn ? cn.value : '';
    const cnpjMatch = cnValue.match(/(\d{14})/);
    const cnpjCert = cnpjMatch ? cnpjMatch[1] : null;

    // Validação crítica: CNPJ do cert deve casar com CNPJ do emitente
    const cnpjEmitente = String(espelho.cnpj || '').replace(/\D/g, '');
    let cnpjMismatch = false;
    if (cnpjCert && cnpjEmitente && cnpjCert !== cnpjEmitente) {
        cnpjMismatch = true;
        console.warn('[SEFAZ] ⚠️ CNPJ do cert (' + cnpjCert + ') NÃO bate com CNPJ do emitente (' + cnpjEmitente + ')');
    }

    return {
        pemCert: forge.pki.certificateToPem(cert),
        pemKey: forge.pki.privateKeyToPem(key),
        cnpj: espelho.cnpj,
        cnpjCert,
        cnpjMismatch,
        certCN: cnValue,
        validade: espelho.certificado_validade,
        ambiente: espelho.ambiente,
        espelho
    };
}

/**
 * Consulta status do serviço SEFAZ-SP (consStatServ).
 * Esta é a chamada mais simples — sem assinatura, só TLS mútuo.
 * Útil como smoke-test do certificado.
 */
async function consultarStatusSP(pool, empresaId = 1) {
    const cred = await loadCertFromDb(pool, empresaId);
    const tpAmb = cred.ambiente === 'producao' ? '1' : '2';

    const host = cred.ambiente === 'producao'
        ? 'nfe.fazenda.sp.gov.br'
        : 'homologacao.nfe.fazenda.sp.gov.br';
    const path = '/ws/nfestatusservico4.asmx';
    const cUF = cred.espelho?.codigo_uf || '35';

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <tpAmb>${tpAmb}</tpAmb>
  <cUF>${cUF}</cUF>
  <xServ>STATUS</xServ>
</consStatServ>`;

    const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Header/>
  <soap:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      ${xmlBody}
    </nfeDadosMsg>
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
                'Content-Length': Buffer.byteLength(soapEnvelope),
                'SOAPAction': ''
            },
            timeout: 15000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const cStatMatch = data.match(/<cStat>([^<]+)<\/cStat>/);
                const xMotivoMatch = data.match(/<xMotivo>([^<]+)<\/xMotivo>/);
                const dhRecbtoMatch = data.match(/<dhRecbto>([^<]+)<\/dhRecbto>/);
                const verAplicMatch = data.match(/<verAplic>([^<]+)<\/verAplic>/);

                resolve({
                    success: res.statusCode === 200 && cStatMatch && cStatMatch[1] === '107',
                    httpStatus: res.statusCode,
                    cStat: cStatMatch ? cStatMatch[1] : null,
                    xMotivo: xMotivoMatch ? xMotivoMatch[1] : 'Resposta SEFAZ não reconhecida',
                    versaoAplicacao: verAplicMatch ? verAplicMatch[1] : null,
                    dhRecbto: dhRecbtoMatch ? dhRecbtoMatch[1] : null,
                    ambiente: cred.ambiente,
                    cnpj: cred.cnpj,
                    cnpjCert: cred.cnpjCert,
                    cnpjMismatch: cred.cnpjMismatch,
                    certCN: cred.certCN,
                    warning: cred.cnpjMismatch
                        ? `⚠️ CNPJ do certificado (${cred.cnpjCert}) NÃO bate com CNPJ do emitente (${cred.cnpj.replace(/\D/g,'')}). Upload do PFX correto necessário.`
                        : null,
                    raw: data.slice(0, 2000)
                });
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout SEFAZ (15s)')); });
        req.on('error', e => reject(new Error('Erro comunicação SEFAZ: ' + e.message)));
        req.write(soapEnvelope);
        req.end();
    });
}

module.exports = {
    loadCertFromDb,
    loadEspelhoFiscal,
    consultarStatusSP
};
