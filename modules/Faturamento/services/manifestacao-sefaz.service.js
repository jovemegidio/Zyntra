// =================================================================
// SERVIÇO MD-e (Manifestação do Destinatário) - ALUFORCE v2.0
// Integração real com SEFAZ via Web Service
// Referência: NT 2012/002, NT 2014/002
// =================================================================
'use strict';

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

let xmlbuilder2;
try { xmlbuilder2 = require('xmlbuilder2'); } catch (e) { /* fallback */ }

// WS URLs por ambiente
const WS_URLS = {
    producao: {
        recepcaoEvento: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
        distDFe: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
    },
    homologacao: {
        recepcaoEvento: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
        distDFe: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
    }
};

// Eventos de manifestação
const EVENTOS = {
    CIENCIA: '210210',
    CONFIRMACAO: '210200',
    DESCONHECIMENTO: '210220',
    NAO_REALIZADA: '210240'
};

const DESC_EVENTOS = {
    '210200': 'Confirmacao da Operacao',
    '210210': 'Ciencia da Operacao',
    '210220': 'Desconhecimento da Operacao',
    '210240': 'Operacao nao Realizada'
};

class ManifestacaoSefazService {

    /**
     * Envia evento de manifestação para a SEFAZ
     * @param {Object} pool - MySQL pool
     * @param {Object} params - { chaveNFe, tipoEvento, justificativa }
     * @returns {Object} resultado do envio
     */
    static async enviarManifestacao(pool, params) {
        const { chaveNFe, tipoEvento, justificativa } = params;

        // Validações
        if (!chaveNFe || chaveNFe.length !== 44) {
            throw new Error('Chave de acesso inválida (deve ter 44 dígitos)');
        }
        if (!EVENTOS[tipoEvento] && !Object.values(EVENTOS).includes(tipoEvento)) {
            throw new Error('Tipo de evento inválido');
        }
        if (tipoEvento === '210240' && (!justificativa || justificativa.length < 15)) {
            throw new Error('Justificativa obrigatória (mín. 15 caracteres) para Operação não Realizada');
        }

        const codEvento = EVENTOS[tipoEvento] || tipoEvento;

        // CNPJ do manifestante (própria empresa = destinatário)
        const [config] = await pool.query('SELECT cnpj FROM empresa_config WHERE id = 1');
        const cnpj = params.cnpj || config[0]?.cnpj || '';

        // Próxima sequência do evento
        let sequencia = 1;
        try {
            const [seqRows] = await pool.query(
                'SELECT MAX(sequencia_evento) as seq FROM manifestacao_eventos WHERE chave_nfe = ? AND tipo_evento = ?',
                [chaveNFe, codEvento]
            );
            sequencia = (seqRows[0]?.seq || 0) + 1;
        } catch (e) { /* tabela pode não existir ainda */ }

        // [MD-e REAL] Delega ao motor NF-e comprovado (cert + assinatura xml-crypto +
        // SOAP NFeRecepcaoEvento4 no Ambiente Nacional). O ambiente (homologação/produção)
        // segue nfeConfig.ambiente, igual ao restante da emissão de NF-e.
        const sefazService = require('./sefaz.service');
        let resultado;
        try {
            resultado = await sefazService.enviarManifestacao({
                chaveAcesso: chaveNFe,
                cnpj,
                tpEvento: codEvento,
                sequenciaEvento: sequencia,
                justificativa
            });
        } catch (e) {
            try {
                await ManifestacaoSefazService._salvarEvento(pool, {
                    chaveNFe, tipoEvento: codEvento, sequencia,
                    xmlEnvio: null, xmlRetorno: null,
                    status: 'erro', protocolo: null,
                    motivo: e.message, userId: params.userId
                });
            } catch (_) { /* tabela pode não existir */ }
            throw new Error(`Erro na comunicação com SEFAZ: ${e.message}`);
        }

        const sucesso = !!resultado.sucesso;

        // Persistir evento
        try {
            await ManifestacaoSefazService._salvarEvento(pool, {
                chaveNFe,
                tipoEvento: codEvento,
                sequencia,
                xmlEnvio: null,
                xmlRetorno: resultado.xmlCompleto || null,
                status: sucesso ? 'autorizado' : 'rejeitado',
                protocolo: resultado.numeroProtocolo,
                motivo: resultado.motivo,
                userId: params.userId
            });
        } catch (_) { /* tabela pode não existir ainda */ }

        // Atualizar status na NF de entrada (se existir)
        try {
            const statusMap = {
                '210200': 'confirmada',
                '210210': 'ciencia',
                '210220': 'desconhecida',
                '210240': 'nao_realizada'
            };
            await pool.query(
                'UPDATE nf_entrada SET manifestacao_status = ? WHERE chave_nfe = ?',
                [statusMap[codEvento] || 'manifestada', chaveNFe]
            );
        } catch (e) { /* NF pode não existir na tabela local */ }

        return {
            sucesso,
            evento: codEvento,
            descricao: DESC_EVENTOS[codEvento],
            chaveNFe,
            protocolo: resultado.numeroProtocolo,
            codigoRetorno: resultado.codigoStatus,
            motivo: resultado.motivo,
            integracaoSEFAZ: true,
            dataHora: new Date().toISOString()
        };
    }

    /**
     * Consulta DistDFe (NF-e destinadas ao CNPJ)
     */
    static async consultarNFeDestinatario(pool, params = {}) {
        const { ultNSU, NSU } = params;

        const [config] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');
        const empresa = config[0] || {};
        const ambiente = empresa.nfe_ambiente || 2;
        const cnpj = String(empresa.cnpj || '').replace(/\D/g, '');
        const cUF = String(empresa.codigo_uf || '35').replace(/\D/g, '') || '35';

        const cert = await ManifestacaoSefazService._getCertificado(empresa, pool);

        // Montar XML de consulta
        let xmlConsulta;
        if (!xmlbuilder2) {
            // Fallback sem xmlbuilder2
            xmlConsulta = `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
                `<tpAmb>${ambiente}</tpAmb>` +
                `<cUFAutor>${cUF}</cUFAutor>` +
                `<CNPJ>${cnpj}</CNPJ>` +
                (NSU
                    ? `<consNSU><NSU>${String(NSU).padStart(15, '0')}</NSU></consNSU>`
                    : `<distNSU><ultNSU>${String(ultNSU || 0).padStart(15, '0')}</ultNSU></distNSU>`) +
                `</distDFeInt>`;
        } else {
            const doc = xmlbuilder2.create({ version: '1.0', encoding: 'UTF-8' });
            const dist = doc.ele('distDFeInt', { xmlns: 'http://www.portalfiscal.inf.br/nfe', versao: '1.01' });
            dist.ele('tpAmb').txt(String(ambiente));
            dist.ele('cUFAutor').txt(cUF);
            dist.ele('CNPJ').txt(cnpj);
            if (NSU) {
                dist.ele('consNSU').ele('NSU').txt(String(NSU).padStart(15, '0'));
            } else {
                dist.ele('distNSU').ele('ultNSU').txt(String(ultNSU || 0).padStart(15, '0'));
            }
            xmlConsulta = doc.end({ prettyPrint: false });
        }

        const urlBase = ambiente === 1 ? WS_URLS.producao : WS_URLS.homologacao;

        try {
            const resultado = await ManifestacaoSefazService._enviarSOAP(
                urlBase.distDFe,
                xmlConsulta,
                'nfeDistDFeInteresse',
                cert
            );

            // Parsear retorno DistDFe
            const documentos = ManifestacaoSefazService._parsearDistDFe(resultado);

            return {
                sucesso: ['137', '138'].includes(documentos.cStat) || (!documentos.cStat && documentos.docs.length >= 0),
                cStat: documentos.cStat,
                xMotivo: documentos.xMotivo,
                error: ['137', '138'].includes(documentos.cStat) || !documentos.cStat ? null : documentos.xMotivo,
                documentos: documentos.docs,
                ultNSU: documentos.ultNSU,
                maxNSU: documentos.maxNSU,
                total: documentos.docs.length
            };
        } catch (e) {
            return {
                sucesso: false,
                error: e.message,
                documentos: [],
                instrucoes: 'Verifique o certificado digital e a conectividade com a SEFAZ'
            };
        }
    }

    // ============================================================
    // GERAÇÃO DE XML
    // ============================================================

    static _gerarXMLEvento({ chaveNFe, cnpj, tipoEvento, sequencia, justificativa, ambiente }) {
        const dhEvento = new Date().toISOString().replace('Z', '-03:00');
        const idEvento = `ID${tipoEvento}${chaveNFe}${String(sequencia).padStart(2, '0')}`;

        if (!xmlbuilder2) {
            // Fallback string XML
            let xml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
                `<infEvento Id="${idEvento}">` +
                `<cOrgao>91</cOrgao>` +
                `<tpAmb>${ambiente}</tpAmb>` +
                `<CNPJ>${cnpj}</CNPJ>` +
                `<chNFe>${chaveNFe}</chNFe>` +
                `<dhEvento>${dhEvento}</dhEvento>` +
                `<tpEvento>${tipoEvento}</tpEvento>` +
                `<nSeqEvento>${sequencia}</nSeqEvento>` +
                `<verEvento>1.00</verEvento>` +
                `<detEvento versao="1.00">` +
                `<descEvento>${DESC_EVENTOS[tipoEvento] || ''}</descEvento>`;

            if (justificativa) {
                xml += `<xJust>${justificativa}</xJust>`;
            }

            xml += `</detEvento></infEvento></evento>`;
            return xml;
        }

        const doc = xmlbuilder2.create();
        const evento = doc.ele('evento', { xmlns: 'http://www.portalfiscal.inf.br/nfe', versao: '1.00' });
        const infEvento = evento.ele('infEvento', { Id: idEvento });
        infEvento.ele('cOrgao').txt('91');
        infEvento.ele('tpAmb').txt(String(ambiente));
        infEvento.ele('CNPJ').txt(cnpj);
        infEvento.ele('chNFe').txt(chaveNFe);
        infEvento.ele('dhEvento').txt(dhEvento);
        infEvento.ele('tpEvento').txt(tipoEvento);
        infEvento.ele('nSeqEvento').txt(String(sequencia));
        infEvento.ele('verEvento').txt('1.00');

        const detEvento = infEvento.ele('detEvento', { versao: '1.00' });
        detEvento.ele('descEvento').txt(DESC_EVENTOS[tipoEvento] || '');

        if (justificativa) {
            detEvento.ele('xJust').txt(justificativa);
        }

        return doc.end({ prettyPrint: false });
    }

    static _gerarXMLLote(xmlEvento, ambiente) {
        const idLote = Date.now().toString().substring(0, 15);

        if (!xmlbuilder2) {
            return `<?xml version="1.0" encoding="UTF-8"?>` +
                `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
                `<idLote>${idLote}</idLote>` +
                xmlEvento +
                `</envEvento>`;
        }

        const doc = xmlbuilder2.create({ version: '1.0', encoding: 'UTF-8' });
        const envEvento = doc.ele('envEvento', { xmlns: 'http://www.portalfiscal.inf.br/nfe', versao: '1.00' });
        envEvento.ele('idLote').txt(idLote);
        // Inserir evento como fragmento
        envEvento.import(xmlbuilder2.fragment(xmlEvento));

        return doc.end({ prettyPrint: false });
    }

    static _wrapSOAP(xmlContent, metodo) {
        const xmlSemProlog = String(xmlContent || '').replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
        if (metodo === 'nfeDistDFeInteresse') {
            const ns = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
            return `<?xml version="1.0" encoding="UTF-8"?>` +
                `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
                `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
                `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
                `<soap12:Body>` +
                `<nfeDistDFeInteresse xmlns="${ns}">` +
                `<nfeDadosMsg>${xmlSemProlog}</nfeDadosMsg>` +
                `</nfeDistDFeInteresse>` +
                `</soap12:Body>` +
                `</soap12:Envelope>`;
        }

        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
            `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
            `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
            `<soap12:Body>` +
            `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${metodo}">` +
            xmlSemProlog +
            `</nfeDadosMsg>` +
            `</soap12:Body>` +
            `</soap12:Envelope>`;
    }

    // ============================================================
    // COMUNICAÇÃO SEFAZ
    // ============================================================

    static async _enviarSOAP(url, xmlContent, metodo, cert) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const options = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8',
                    'Content-Length': 0
                },
                timeout: 30000,
                minVersion: 'TLSv1.2'
            };

            // Adicionar certificado se disponível
            if (cert) {
                if (cert.pfx) {
                    options.pfx = cert.pfx;
                    options.passphrase = cert.senha;
                } else if (cert.cert && cert.key) {
                    options.cert = cert.cert;
                    options.key = cert.key;
                }
            }

            const soapEnvelope = ManifestacaoSefazService._wrapSOAP(xmlContent, metodo);
            options.headers['Content-Length'] = Buffer.byteLength(soapEnvelope);
            if (metodo === 'nfeDistDFeInteresse') {
                options.headers['Content-Type'] = 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"';
            }

            let req;
            try {
                req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    }
                });
                });
            } catch (e) {
                return reject(new Error(ManifestacaoSefazService._normalizarErroCertificado(e)));
            }

            req.on('error', (e) => reject(new Error(ManifestacaoSefazService._normalizarErroCertificado(e, 'Erro de rede'))));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout na comunicação com SEFAZ (30s)'));
            });

            req.write(soapEnvelope);
            req.end();
        });
    }

    // ============================================================
    // PARSERS DE RETORNO
    // ============================================================

    static _parsearRetorno(xmlRetorno) {
        const getTag = (xml, tag) => {
            const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
            return match ? match[1] : '';
        };

        const cStat = getTag(xmlRetorno, 'cStat');
        const xMotivo = getTag(xmlRetorno, 'xMotivo');
        const nProt = getTag(xmlRetorno, 'nProt');

        // cStat 128 = Lote processado, verificar retEvento
        // cStat 135 ou 136 = Evento registrado com sucesso
        const sucesso = ['128', '135', '136'].includes(cStat);

        return {
            sucesso,
            codigoRetorno: cStat,
            motivo: xMotivo,
            protocolo: nProt
        };
    }

    static _parsearDistDFe(xmlRetorno) {
        const docs = [];
        const getTag = (xml, tag) => {
            const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
            return match ? match[1] : '';
        };

        const ultNSU = getTag(xmlRetorno, 'ultNSU');
        const maxNSU = getTag(xmlRetorno, 'maxNSU');
        const cStat = getTag(xmlRetorno, 'cStat');
        const xMotivo = getTag(xmlRetorno, 'xMotivo');

        // Extrair documentos (docZip)
        const docZipRegex = /<docZip[^>]*NSU="(\d+)"[^>]*schema="([^"]*)"[^>]*>([^<]*)<\/docZip>/gi;
        let match;
        while ((match = docZipRegex.exec(xmlRetorno)) !== null) {
            docs.push({
                nsu: match[1],
                schema: match[2],
                conteudoBase64: match[3]
                // Decodificar: Buffer.from(match[3], 'base64') → inflate → XML da NF-e
            });
        }

        return { docs, ultNSU, maxNSU, cStat, xMotivo };
    }

    // ============================================================
    // CERTIFICADO DIGITAL
    // ============================================================

    static async _getCertificado(empresa, pool) {
        if (pool) {
            try {
                const { loadCertFromDb } = require('../../../services/sefaz.service');
                const cred = await loadCertFromDb(pool, empresa?.id || 1);
                return {
                    cert: cred.pemCert,
                    key: cred.pemKey
                };
            } catch (e) {
                const msg = ManifestacaoSefazService._normalizarErroCertificado(e);
                const podeTentarFallback = /não configurado|nao configurado/i.test(msg);
                if (!podeTentarFallback) {
                    throw new Error(msg);
                }
            }
        }

        try {
            // Tentar carregar PFX
            const certDir = path.join(__dirname, '..', '..', '..', 'ssl');
            const pfxFiles = fs.readdirSync(certDir).filter(f => f.endsWith('.pfx') || f.endsWith('.p12'));

            if (pfxFiles.length > 0) {
                const pfxPath = path.join(certDir, pfxFiles[0]);
                const pfxBuffer = fs.readFileSync(pfxPath);
                return {
                    pfx: pfxBuffer,
                    senha: empresa.certificado_senha || process.env.CERT_SENHA || ''
                };
            }

            // Tentar PEM
            const certPath = path.join(certDir, 'certificado.pem');
            const keyPath = path.join(certDir, 'chave-privada.pem');
            if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
                return {
                    cert: fs.readFileSync(certPath),
                    key: fs.readFileSync(keyPath)
                };
            }

            console.warn('[MD-e] Certificado digital não encontrado em', certDir);
            throw new Error('Certificado digital A1 não configurado.');
        } catch (e) {
            const msg = ManifestacaoSefazService._normalizarErroCertificado(e);
            console.warn('[MD-e] Erro ao carregar certificado:', msg);
            throw new Error(msg);
        }
    }

    static _normalizarErroCertificado(error, prefixo) {
        const msg = String(error?.message || error || '');
        let normalizado = msg;
        if (/mac verify failure|invalid password|bad decrypt|unsupported pkcs12/i.test(msg)) {
            normalizado = 'Senha do certificado digital incorreta ou arquivo PFX/P12 incompatível. Reenvie o certificado A1 correto em Configurações > Certificado Digital.';
        }
        if (/no such file|ENOENT/i.test(msg)) {
            normalizado = 'Arquivo do certificado digital não encontrado. Reenvie o certificado A1 em Configurações > Certificado Digital.';
        }
        return prefixo ? `${prefixo}: ${normalizado}` : normalizado;
    }

    static async _assinarXML(xml, cert) {
        // Assinatura XML com xmldsig (requer xml-crypto ou similar)
        try {
            const SignedXml = require('xml-crypto').SignedXml;
            const sig = new SignedXml();
            sig.signingKey = cert.key || cert.pfx;
            sig.addReference("//*[local-name(.)='infEvento']", [
                'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
            ], 'http://www.w3.org/2000/09/xmldsig#sha1');
            sig.computeSignature(xml);
            return sig.getSignedXml();
        } catch (e) {
            console.warn('[MD-e] xml-crypto não disponível, XML não assinado:', e.message);
            return xml; // Retornar sem assinatura (funciona em homologação para testes)
        }
    }

    // ============================================================
    // PERSISTÊNCIA
    // ============================================================

    static async _salvarEvento(pool, dados) {
        try {
            // Criar tabela se não existir
            await pool.query(`
                CREATE TABLE IF NOT EXISTS manifestacao_eventos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    chave_nfe VARCHAR(44) NOT NULL,
                    tipo_evento VARCHAR(6) NOT NULL,
                    sequencia_evento INT DEFAULT 1,
                    descricao_evento VARCHAR(100) NULL,
                    xml_envio LONGTEXT NULL,
                    xml_retorno LONGTEXT NULL,
                    status ENUM('pendente', 'autorizado', 'rejeitado', 'erro') DEFAULT 'pendente',
                    protocolo VARCHAR(20) NULL,
                    codigo_retorno VARCHAR(5) NULL,
                    motivo_retorno VARCHAR(500) NULL,
                    data_evento DATETIME DEFAULT CURRENT_TIMESTAMP,
                    usuario_id INT NULL,
                    INDEX idx_manif_chave (chave_nfe),
                    INDEX idx_manif_tipo (tipo_evento),
                    INDEX idx_manif_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                INSERT INTO manifestacao_eventos (
                    chave_nfe, tipo_evento, sequencia_evento, descricao_evento,
                    xml_envio, xml_retorno, status, protocolo, motivo_retorno, usuario_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                dados.chaveNFe, dados.tipoEvento, dados.sequencia,
                DESC_EVENTOS[dados.tipoEvento] || '',
                dados.xmlEnvio, dados.xmlRetorno,
                dados.status, dados.protocolo, dados.motivo,
                dados.userId || null
            ]);
        } catch (e) {
            console.error('[MD-e] Erro ao salvar evento:', e.message);
        }
    }
}

module.exports = { ManifestacaoSefazService, EVENTOS, DESC_EVENTOS, WS_URLS };
