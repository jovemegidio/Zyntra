/**
 * Serviço de Certificado Digital
 * Gerencia certificados A1 (.pfx) para assinatura de NFe
 * 
 * @module CertificadoService
 */

const forge = require('node-forge');
const fs = require('fs').promises;
const path = require('path');

class CertificadoService {
    constructor(pool) {
        this.pool = pool;
        this.certificadosPath = path.join(__dirname, '..', '..', '..', 'uploads', 'certificados');
    }

    /**
     * Faz upload e valida certificado digital A1
     * @param {Buffer} pfxBuffer - Buffer do arquivo .pfx
     * @param {string} senha - Senha do certificado
     * @param {number} empresaId - ID da empresa
     * @returns {Promise<Object>} Dados do certificado
     */
    async uploadCertificado(pfxBuffer, senha, empresaId = 1) {
        try {
            // Validar certificado
            const certData = await this.validarCertificado(pfxBuffer, senha);
            
            // Extrair informações
            const info = this.extrairInformacoes(certData);
            
            // Verificar validade
            const hoje = new Date();
            if (info.validade < hoje) {
                throw new Error('Certificado vencido');
            }
            
            const diasRestantes = Math.ceil((info.validade - hoje) / (1000 * 60 * 60 * 24));
            if (diasRestantes < 30) {
                console.warn(`⚠️  Certificado vence em ${diasRestantes} dias`);
            }
            
            // Criptografar senha
            const senhaCriptografada = this.criptografarSenha(senha);
            
            // Salvar no banco de dados
            await this.salvarNoBanco(empresaId, pfxBuffer, senhaCriptografada, info);
            
            // Salvar arquivo físico (backup)
            await this.salvarArquivo(empresaId, pfxBuffer);
            
            return {
                success: true,
                message: 'Certificado instalado com sucesso',
                info: {
                    cnpj: info.cnpj,
                    razaoSocial: info.razaoSocial,
                    validade: info.validade,
                    diasRestantes: diasRestantes,
                    emissor: info.emissor
                }
            };
            
        } catch (error) {
            console.error('❌ Erro ao fazer upload do certificado:', error);
            throw new Error(`Falha ao processar certificado: ${error.message}`);
        }
    }

    /**
     * Valida certificado digital
     * @param {Buffer} pfxBuffer - Buffer do certificado
     * @param {string} senha - Senha do certificado
     * @returns {Promise<Object>} Dados do certificado decodificado
     */
    async validarCertificado(pfxBuffer, senha) {
        try {
            // Converter Buffer para base64
            const pfxBase64 = pfxBuffer.toString('base64');
            const pfxAsn1 = forge.util.decode64(pfxBase64);
            
            // Decodificar PKCS#12
            const p12Asn1 = forge.asn1.fromDer(pfxAsn1);
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
            
            // Extrair bags (certificado e chave privada)
            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            const pkeyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            
            if (!certBags || !certBags[forge.pki.oids.certBag] || certBags[forge.pki.oids.certBag].length === 0) {
                throw new Error('Certificado não encontrado no arquivo .pfx');
            }
            
            if (!pkeyBags || !pkeyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || pkeyBags[forge.pki.oids.pkcs8ShroudedKeyBag].length === 0) {
                throw new Error('Chave privada não encontrada no arquivo .pfx');
            }
            
            const cert = certBags[forge.pki.oids.certBag][0].cert;
            const pkey = pkeyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
            
            // Validar se o certificado não está expirado
            const agora = new Date();
            if (cert.validity.notBefore > agora) {
                throw new Error('Certificado ainda não está válido');
            }
            
            if (cert.validity.notAfter < agora) {
                throw new Error('Certificado expirado');
            }
            
            return {
                certificate: cert,
                privateKey: pkey,
                p12: p12,
                pfxBuffer: pfxBuffer
            };
            
        } catch (error) {
            if (error.message.includes('Invalid password')) {
                throw new Error('Senha do certificado incorreta');
            }
            throw error;
        }
    }

    /**
     * Extrai informações do certificado
     * @param {Object} certData - Dados do certificado
     * @returns {Object} Informações extraídas
     */
    extrairInformacoes(certData) {
        const cert = certData.certificate;
        
        // Extrair CN (Common Name) - geralmente contém CNPJ e razão social
        const cn = cert.subject.getField('CN');
        const cnValue = cn ? cn.value : '';
        
        // Extrair CNPJ do CN (formato: RAZAO SOCIAL:CNPJ)
        let cnpj = '';
        let razaoSocial = '';
        
        const cnpjMatch = cnValue.match(/(\d{14})/);
        if (cnpjMatch) {
            cnpj = cnpjMatch[1];
            cnpj = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
            
            razaoSocial = cnValue.split(':')[0].trim();
        }
        
        // Extrair emissor
        const issuerCN = cert.issuer.getField('CN');
        const emissor = issuerCN ? issuerCN.value : 'Desconhecido';
        
        return {
            cnpj: cnpj,
            razaoSocial: razaoSocial,
            validade: cert.validity.notAfter,
            emissao: cert.validity.notBefore,
            emissor: emissor,
            serialNumber: cert.serialNumber
        };
    }

    /**
     * Assina XML com o certificado
     * @param {string} xml - XML a ser assinado
     * @param {number} empresaId - ID da empresa
     * @returns {Promise<string>} XML assinado
     */
    async assinarXML(xml, empresaId = 1) {
        try {
            // Buscar certificado do banco
            const [configs] = await this.pool.query(
                'SELECT certificado_pfx, certificado_senha FROM nfe_configuracoes WHERE empresa_id = ?',
                [empresaId]
            );
            
            if (!configs || configs.length === 0 || !configs[0].certificado_pfx) {
                throw new Error('Certificado não configurado para esta empresa');
            }
            
            const pfxBuffer = configs[0].certificado_pfx;
            const senhaDescriptografada = this.descriptografarSenha(configs[0].certificado_senha);
            
            // Validar e carregar certificado
            const certData = await this.validarCertificado(pfxBuffer, senhaDescriptografada);
            
            // Assinar XML
            const xmlAssinado = this.assinarXMLComCertificado(xml, certData);
            
            return xmlAssinado;
            
        } catch (error) {
            console.error('❌ Erro ao assinar XML:', error);
            throw new Error(`Falha ao assinar XML: ${error.message}`);
        }
    }

    /**
     * Assina XML com certificado carregado
     * @param {string} xml - XML a ser assinado
     * @param {Object} certData - Dados do certificado
     * @returns {string} XML assinado
     */
    assinarXMLComCertificado(xml, certData) {
        const cert = certData.certificate;
        const pkey = certData.privateKey;
        
        // Encontrar tag a ser assinada (geralmente <infNFe> ou <infEvento>)
        const tagMatch = xml.match(/<(infNFe|infEvento|infInut)[^>]*>/);
        if (!tagMatch) {
            throw new Error('Tag para assinatura não encontrada no XML');
        }
        
        const tagName = tagMatch[1];
        const idMatch = xml.match(new RegExp(`<${tagName}[^>]*Id="([^"]+)"`));
        if (!idMatch) {
            throw new Error('Atributo Id não encontrado na tag de assinatura');
        }
        
        const id = idMatch[1];
        
        // Extrair conteúdo a ser assinado
        const regex = new RegExp(`(<${tagName}[^>]*>.*?</${tagName}>)`, 's');
        const contentMatch = xml.match(regex);
        if (!contentMatch) {
            throw new Error('Conteúdo para assinatura não encontrado');
        }
        
        const contentToSign = contentMatch[1];
        
        // Canonicalizar XML (C14N)
        const md = forge.md.sha1.create();
        md.update(contentToSign, 'utf8');
        const digest = md.digest().toHex();
        
        // Criar SignedInfo
        const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
            <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
            <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
            <Reference URI="#${id}">
                <Transforms>
                    <Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
                    <Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
                </Transforms>
                <DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
                <DigestValue>${forge.util.encode64(digest)}</DigestValue>
            </Reference>
        </SignedInfo>`;
        
        // Assinar SignedInfo
        const mdSigned = forge.md.sha1.create();
        mdSigned.update(signedInfo, 'utf8');
        const signature = pkey.sign(mdSigned);
        const signatureValue = forge.util.encode64(signature);
        
        // Obter certificado em base64
        const certPem = forge.pki.certificateToPem(cert);
        const certBase64 = certPem.replace(/-----BEGIN CERTIFICATE-----/, '')
                                    .replace(/-----END CERTIFICATE-----/, '')
                                    .replace(/\n/g, '');
        
        // Montar assinatura completa
        const xmlSignature = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
            ${signedInfo}
            <SignatureValue>${signatureValue}</SignatureValue>
            <KeyInfo>
                <X509Data>
                    <X509Certificate>${certBase64}</X509Certificate>
                </X509Data>
            </KeyInfo>
        </Signature>`;
        
        // Inserir assinatura no XML
        const xmlAssinado = xml.replace(
            new RegExp(`(</${tagName}>)`),
            `${xmlSignature}$1`
        );
        
        return xmlAssinado;
    }

    /**
     * Salva certificado no banco de dados
     */
    async salvarNoBanco(empresaId, pfxBuffer, senhaCriptografada, info) {
        const [existing] = await this.pool.query(
            'SELECT id FROM nfe_configuracoes WHERE empresa_id = ?',
            [empresaId]
        );
        
        if (existing && existing.length > 0) {
            // Atualizar
            await this.pool.query(
                `UPDATE nfe_configuracoes 
                 SET certificado_pfx = ?, 
                     certificado_senha = ?, 
                     certificado_validade = ?,
                     certificado_cnpj = ?,
                     certificado_nome = ?
                 WHERE empresa_id = ?`,
                [pfxBuffer, senhaCriptografada, info.validade, info.cnpj, info.razaoSocial, empresaId]
            );
        } else {
            // Inserir
            await this.pool.query(
                `INSERT INTO nfe_configuracoes 
                 (empresa_id, certificado_pfx, certificado_senha, certificado_validade, certificado_cnpj, certificado_nome)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [empresaId, pfxBuffer, senhaCriptografada, info.validade, info.cnpj, info.razaoSocial]
            );
        }
    }

    /**
     * Salva arquivo físico do certificado
     */
    async salvarArquivo(empresaId, pfxBuffer) {
        try {
            await fs.mkdir(this.certificadosPath, { recursive: true });
            const filename = `empresa_${empresaId}.pfx`;
            const filepath = path.join(this.certificadosPath, filename);
            await fs.writeFile(filepath, pfxBuffer);
        } catch (error) {
            console.warn('⚠️  Não foi possível salvar arquivo físico:', error.message);
        }
    }

    /**
     * Obtém status do certificado
     */
    async getStatus(empresaId = 1) {
        const [configs] = await this.pool.query(
            'SELECT certificado_validade, certificado_cnpj, certificado_nome FROM nfe_configuracoes WHERE empresa_id = ?',
            [empresaId]
        );
        
        if (!configs || configs.length === 0 || !configs[0].certificado_validade) {
            return {
                configurado: false,
                message: 'Nenhum certificado configurado'
            };
        }
        
        const config = configs[0];
        const validade = new Date(config.certificado_validade);
        const hoje = new Date();
        const diasRestantes = Math.ceil((validade - hoje) / (1000 * 60 * 60 * 24));
        
        return {
            configurado: true,
            cnpj: config.certificado_cnpj,
            razaoSocial: config.certificado_nome,
            validade: validade,
            diasRestantes: diasRestantes,
            status: diasRestantes > 30 ? 'valido' : diasRestantes > 0 ? 'expirando' : 'expirado'
        };
    }

    /**
     * Remove certificado
     */
    async removerCertificado(empresaId = 1) {
        await this.pool.query(
            `UPDATE nfe_configuracoes 
             SET certificado_pfx = NULL, 
                 certificado_senha = NULL, 
                 certificado_validade = NULL,
                 certificado_cnpj = NULL,
                 certificado_nome = NULL
             WHERE empresa_id = ?`,
            [empresaId]
        );
        
        return { success: true, message: 'Certificado removido' };
    }

    // Métodos auxiliares de criptografia
    criptografarSenha(senha) {
        // Simples base64 por enquanto - em produção usar crypto adequado
        return Buffer.from(senha).toString('base64');
    }

    descriptografarSenha(senhaCriptografada) {
        return Buffer.from(senhaCriptografada, 'base64').toString('utf8');
    }
}

module.exports = CertificadoService;
