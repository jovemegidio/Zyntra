const forge = require('node-forge');
const fs = require('fs').promises;
const path = require('path');

/**
 * SERVIÇO DE CERTIFICADO DIGITAL
 * Gerenciamento de certificados A1 (arquivo) e A3 (token/cartão)
 */

class CertificadoService {
    constructor() {
        this.certificado = null;
        this.chavePriva = null;
        this.certificadoCarregado = false;
        this.cnpj = null;
    }

    normalizarCnpj(valor) {
        const digitos = String(valor || '').replace(/\D/g, '');
        return digitos.length === 14 ? digitos : '';
    }

    extrairCnpj(certificado) {
        // 1) e-CNPJ ICP-Brasil: o CNPJ do TITULAR vem no commonName no formato
        //    "RAZÃO SOCIAL:CNPJ". Os organizationalUnitName podem conter o CNPJ da
        //    AR (autoridade de registro), que NÃO é o emitente — por isso o CN tem
        //    prioridade sobre a varredura genérica (evita pegar o CNPJ da AR).
        const cn = (certificado?.subject?.attributes || [])
            .find(a => a?.name === 'commonName' || a?.shortName === 'CN');
        if (cn?.value) {
            const cnpjCN = this.normalizarCnpj(String(cn.value).split(':').pop());
            if (cnpjCN) return cnpjCN;
        }

        // 2) SubjectAltName otherName OID 2.16.76.1.3.3 — local canônico do CNPJ
        //    do titular na ICP-Brasil.
        for (const ext of (certificado?.extensions || [])) {
            if (ext?.name === 'subjectAltName' && Array.isArray(ext.altNames)) {
                for (const alt of ext.altNames) {
                    const grupos = String(alt?.value || '').match(/\d{14}/g) || [];
                    for (const grupo of grupos) {
                        const cnpj = this.normalizarCnpj(grupo);
                        if (cnpj) return cnpj;
                    }
                }
            }
        }

        // 3) Fallback genérico (legado) — último recurso para certificados atípicos.
        const atributos = [
            ...(certificado?.subject?.attributes || []),
            ...(certificado?.extensions || [])
        ];

        for (const atributo of atributos) {
            const valor = atributo?.value || atributo?.name || '';
            const grupos = String(valor).match(/\d+/g) || [];
            for (const grupo of grupos) {
                const cnpj = this.normalizarCnpj(grupo);
                if (cnpj) return cnpj;
            }
        }

        return '';
    }
    
    /**
     * Carregar certificado A1 (PFX/P12)
     */
    async carregarCertificadoA1(caminhoArquivo, senha, opcoes = {}) {
        try {
            // Modernização automática: certs A1 ICP-Brasil legados (RC2/3DES) que o tls do
            // Node recusa (necessário para transmitir à SEFAZ) são convertidos in-place.
            // Nunca lança; se falhar, segue com o arquivo original (forge carrega mesmo assim).
            try { require('./pfx-modernizer').ensureModernPfx(caminhoArquivo, senha); } catch (_) { /* noop */ }
            const arquivoPfx = await fs.readFile(caminhoArquivo);
            const p12Asn1 = forge.asn1.fromDer(arquivoPfx.toString('binary'));
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
            
            // Extrair chave privada
            const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            const bag = bags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
            if (!bag?.key) throw new Error('Chave privada não encontrada no arquivo PFX');
            const chavePrivada = bag.key;
            
            // Extrair certificado
            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            const certBag = certBags[forge.pki.oids.certBag]?.[0];
            if (!certBag?.cert) throw new Error('Certificado não encontrado no arquivo PFX');
            const certificado = certBag.cert;
            const agora = new Date();
            if (agora < certificado.validity.notBefore || agora > certificado.validity.notAfter) {
                throw new Error('Certificado fora do período de validade');
            }

            const cnpj = this.extrairCnpj(certificado);
            const cnpjEsperado = this.normalizarCnpj(opcoes.cnpjEsperado || process.env.EMITENTE_CNPJ);
            if (!cnpj) {
                throw new Error('Não foi possível identificar o CNPJ no certificado');
            }
            if (cnpjEsperado && cnpj !== cnpjEsperado) {
                throw new Error(`CNPJ do certificado não corresponde ao CNPJ configurado nesta instância`);
            }
            
            this.chavePriva = chavePrivada;
            this.certificado = certificado;
            this.cnpj = cnpj;
            this.certificadoCarregado = true;
            
            return {
                success: true,
                cnpj,
                validade: {
                    inicio: this.certificado.validity.notBefore,
                    fim: this.certificado.validity.notAfter
                },
                subject: this.certificado.subject.attributes.map(attr => ({
                    name: attr.name,
                    value: attr.value
                })),
                issuer: this.certificado.issuer.attributes.map(attr => ({
                    name: attr.name,
                    value: attr.value
                }))
            };
        } catch (error) {
            throw new Error(`Erro ao carregar certificado: ${error.message}`);
        }
    }
    
    /**
     * Verificar se certificado está válido
     */
    verificarValidade() {
        if (!this.certificadoCarregado) {
            throw new Error('Certificado não carregado');
        }
        
        const agora = new Date();
        const valido = agora >= this.certificado.validity.notBefore && 
                      agora <= this.certificado.validity.notAfter;
        
        if (!valido) {
            throw new Error('Certificado fora do período de validade');
        }
        
        return {
            valido: true,
            diasRestantes: Math.floor(
                (this.certificado.validity.notAfter - agora) / (1000 * 60 * 60 * 24)
            )
        };
    }
    
    /**
     * Assinar XML
     */
    async assinarXML(xmlString, tagAssinatura = 'infNFe') {
        if (!this.certificadoCarregado) {
            throw new Error('Certificado não carregado');
        }
        
        try {
            // [FIX C14N] Assinatura via xml-crypto (Canonical XML 1.0 correto, com namespaces
            // herdados explícitos e ordenação de atributos). O C14N caseiro por regex gerava
            // digest divergente do calculado pela SEFAZ → rejeição 215/225/297.
            // NF-e 4.00 exige: RSA-SHA1 + DigestMethod SHA-1 + C14N (não exclusiva).
            const { SignedXml } = require('xml-crypto');
            const keyPem = forge.pki.privateKeyToPem(this.chavePriva);
            const certPem = forge.pki.certificateToPem(this.certificado);
            const certBase64 = certPem
                .replace(/-----BEGIN CERTIFICATE-----/g, '')
                .replace(/-----END CERTIFICATE-----/g, '')
                .replace(/[\r\n]/g, '');
            const xpath = `//*[local-name()='${tagAssinatura}']`;
            const keyInfoXml = `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
            const transforms = [
                'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
            ];
            const ALG_SIG = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
            const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
            const ALG_DIGEST = 'http://www.w3.org/2000/09/xmldsig#sha1';

            // [COMPAT xml-crypto] A API mudou entre versões: a v3+ usa opções-objeto
            // (addReference({xpath,...})); a v2 (presente em prod) é POSICIONAL
            // (addReference(xpath, transforms, digest) + sig.signingKey/keyInfoProvider).
            // Tentamos a API nova e caímos para a antiga — mesma assinatura nas duas.
            const assinarComApiObjeto = () => {
                const sig = new SignedXml({
                    privateKey: keyPem,
                    publicCert: certPem,
                    signatureAlgorithm: ALG_SIG,
                    canonicalizationAlgorithm: ALG_C14N,
                    getKeyInfoContent: () => keyInfoXml
                });
                sig.addReference({ xpath, transforms, digestAlgorithm: ALG_DIGEST });
                // Signature é filha do elemento-raiz (NFe/CTe/evento), logo APÓS infNFe/infEvento
                sig.computeSignature(xmlString, { location: { reference: xpath, action: 'after' } });
                return sig.getSignedXml();
            };

            const assinarComApiPosicional = () => {
                const sig = new SignedXml();
                sig.signingKey = keyPem;
                sig.signatureAlgorithm = ALG_SIG;
                sig.canonicalizationAlgorithm = ALG_C14N;
                sig.keyInfoProvider = { getKeyInfo: () => keyInfoXml };
                sig.addReference(xpath, transforms, ALG_DIGEST);
                sig.computeSignature(xmlString, { location: { reference: xpath, action: 'after' } });
                return sig.getSignedXml();
            };

            let xmlAssinado;
            try {
                xmlAssinado = assinarComApiObjeto();
            } catch (e1) {
                xmlAssinado = assinarComApiPosicional();
            }
            if (!/<Signature[\s>]/.test(xmlAssinado)) {
                throw new Error('Assinatura não foi inserida no XML');
            }
            return xmlAssinado;
        } catch (error) {
            throw new Error(`Erro ao assinar XML: ${error.message}`);
        }
    }
    
    /**
     * Criar SignedInfo
     */
    criarSignedInfo(referenceId, digestValue) {
        return `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
<Reference URI="#${referenceId}">
<Transforms>
<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
</Transforms>
<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
<DigestValue>${digestValue}</DigestValue>
</Reference>
</SignedInfo>`;
    }
    
    /**
     * Extrair conteúdo de uma tag XML
     */
    extrairConteudoTag(xml, tagName, id) {
        const regex = new RegExp(`<${tagName}[^>]*Id="${id}"[^>]*>([\\s\\S]*?)</${tagName}>`, 'm');
        const match = xml.match(regex);
        
        if (!match) {
            throw new Error(`Tag ${tagName} com Id="${id}" não encontrada`);
        }
        
        return match[0];
    }
    
    /**
     * Canonicalizar XML (C14N)
     */
    canonicalizarXML(xml) {
        // C14N simplificada compatível com SEFAZ NF-e 4.00
        return xml
            .replace(/\r\n/g, '\n')      // Normaliza line endings
            .replace(/\r/g, '\n')         // CR → LF  
            .replace(/>\s+</g, '><')       // Remove espaços entre tags
            .replace(/\s+\/>/g, '/>')      // Remove espaços antes de />
            .replace(/\n/g, '')            // Remove newlines
            .trim();
    }
    
    /**
     * Obter certificado em formato PEM (string)
     * Usado pelo SefazService para configurar httpsAgent TLS
     */
    getCertificadoPEM() {
        if (!this.certificadoCarregado) {
            throw new Error('Certificado não carregado — chame carregarCertificadoA1() primeiro');
        }
        return forge.pki.certificateToPem(this.certificado);
    }

    /**
     * Obter chave privada em formato PEM (string)
     * Usado pelo SefazService para configurar httpsAgent TLS
     */
    getChavePrivadaPEM() {
        if (!this.certificadoCarregado) {
            throw new Error('Certificado não carregado — chame carregarCertificadoA1() primeiro');
        }
        return forge.pki.privateKeyToPem(this.chavePriva);
    }

    /**
     * Obter informações do certificado
     */
    getInfoCertificado() {
        if (!this.certificadoCarregado) {
            throw new Error('Certificado não carregado');
        }
        
        const getCN = (subject) => {
            const cn = subject.attributes.find(attr => attr.name === 'commonName');
            return cn ? cn.value : '';
        };
        
        return {
            cnpj: this.cnpj,
            titular: getCN(this.certificado.subject),
            emissor: getCN(this.certificado.issuer),
            validadeInicio: this.certificado.validity.notBefore,
            validadeFim: this.certificado.validity.notAfter,
            serialNumber: this.certificado.serialNumber,
            fingerprintSha256: forge.md.sha256.create()
                .update(forge.asn1.toDer(forge.pki.certificateToAsn1(this.certificado)).getBytes())
                .digest()
                .toHex()
        };
    }

    validarParaEmitente(cnpjEmitente) {
        if (!this.certificadoCarregado) {
            throw new Error('Certificado não carregado');
        }

        this.verificarValidade();
        const emitente = this.normalizarCnpj(cnpjEmitente);
        if (!emitente) throw new Error('CNPJ do emitente inválido');
        if (emitente !== this.cnpj) {
            throw new Error('CNPJ do emitente difere do certificado digital desta instância');
        }
        return true;
    }
}

module.exports = new CertificadoService();
