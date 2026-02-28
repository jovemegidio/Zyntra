/**
 * Extrator de dados do Certificado Digital A1
 * Extrai CNPJ, Razão Social e validade do certificado .pfx
 */

const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

class CertificadoExtractor {
    
    /**
     * Extrai informações do certificado A1
     * @param {string} certPath - Caminho do arquivo .pfx
     * @param {string} senha - Senha do certificado
     * @returns {Object} Dados extraídos do certificado
     */
    static extrairDados(certPath, senha) {
        try {
            // Ler o arquivo do certificado
            const pfxBuffer = fs.readFileSync(certPath);
            const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
            const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senha);
            
            // Obter o certificado
            const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
            const cert = certBags[forge.pki.oids.certBag][0].cert;
            
            // Extrair dados do subject
            const subject = cert.subject;
            const issuer = cert.issuer;
            
            // Função auxiliar para buscar atributo
            const getAttr = (obj, shortName) => {
                const attr = obj.attributes.find(a => a.shortName === shortName);
                return attr ? attr.value : null;
            };
            
            // Extrair CN (Common Name) que contém CNPJ e Razão Social
            const cn = getAttr(subject, 'CN') || '';
            
            // Padrões para extrair CNPJ
            // Formato comum: "RAZAO SOCIAL:12345678000199"
            // ou "12345678000199:RAZAO SOCIAL"
            let cnpj = null;
            let razaoSocial = null;
            
            // Tentar extrair CNPJ do CN
            const cnpjMatch = cn.match(/(\d{14})/);
            if (cnpjMatch) {
                cnpj = cnpjMatch[1];
                // Formatar CNPJ
                cnpj = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
            }
            
            // Razão Social geralmente está no CN antes ou depois do CNPJ
            if (cn.includes(':')) {
                const parts = cn.split(':');
                razaoSocial = parts.find(p => !p.match(/^\d+$/))?.trim();
            } else {
                // Tentar pegar do campo O (Organization)
                razaoSocial = getAttr(subject, 'O');
            }
            
            // Dados de validade
            const validadeInicio = cert.validity.notBefore;
            const validadeFim = cert.validity.notAfter;
            
            // Calcular dias restantes
            const hoje = new Date();
            const diasRestantes = Math.ceil((validadeFim - hoje) / (1000 * 60 * 60 * 24));
            
            // Verificar se está vencido
            const vencido = hoje > validadeFim;
            const proximoVencimento = diasRestantes <= 30 && !vencido;
            
            // Dados do emissor (Certificadora)
            const certificadora = getAttr(issuer, 'CN') || getAttr(issuer, 'O');
            
            // UF do certificado (se disponível)
            const uf = getAttr(subject, 'ST') || null;
            
            return {
                success: true,
                dados: {
                    cnpj: cnpj,
                    razaoSocial: razaoSocial || getAttr(subject, 'O'),
                    nomeResponsavel: getAttr(subject, 'CN'),
                    uf: uf,
                    
                    // Validade
                    validadeInicio: validadeInicio.toISOString(),
                    validadeFim: validadeFim.toISOString(),
                    diasRestantes: diasRestantes,
                    vencido: vencido,
                    proximoVencimento: proximoVencimento,
                    
                    // Certificadora
                    certificadora: certificadora,
                    
                    // Serial
                    serialNumber: cert.serialNumber,
                    
                    // Alertas
                    alertas: []
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                dados: null
            };
        }
    }
    
    /**
     * Valida se o certificado está válido para uso
     */
    static validarCertificado(certPath, senha) {
        const resultado = this.extrairDados(certPath, senha);
        
        if (!resultado.success) {
            return {
                valido: false,
                motivo: `Erro ao ler certificado: ${resultado.error}`
            };
        }
        
        const dados = resultado.dados;
        
        if (dados.vencido) {
            return {
                valido: false,
                motivo: `Certificado vencido em ${new Date(dados.validadeFim).toLocaleDateString('pt-BR')}`
            };
        }
        
        if (!dados.cnpj) {
            return {
                valido: false,
                motivo: 'Não foi possível extrair o CNPJ do certificado'
            };
        }
        
        return {
            valido: true,
            dados: dados,
            avisos: dados.proximoVencimento ? 
                [`Certificado vence em ${dados.diasRestantes} dias!`] : []
        };
    }
    
    /**
     * Atualiza o .env com os dados do certificado
     */
    static atualizarEnvComCertificado(envPath, dadosCert) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Atualizar campos
        const updates = {
            'EMPRESA_CNPJ': dadosCert.cnpj?.replace(/\D/g, '') || '',
            'EMPRESA_RAZAO_SOCIAL': dadosCert.razaoSocial || '',
            'EMPRESA_UF': dadosCert.uf || ''
        };
        
        for (const [key, value] of Object.entries(updates)) {
            if (value) {
                const regex = new RegExp(`^${key}=.*$`, 'm');
                if (envContent.match(regex)) {
                    envContent = envContent.replace(regex, `${key}=${value}`);
                } else {
                    envContent += `\n${key}=${value}`;
                }
            }
        }
        
        fs.writeFileSync(envPath, envContent);
        
        return {
            success: true,
            atualizados: Object.keys(updates).filter(k => updates[k])
        };
    }
}

// Se executado diretamente
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('Uso: node extrair-certificado.js <caminho.pfx> <senha>');
        process.exit(1);
    }
    
    const [certPath, senha] = args;
    
    console.log('\n🔐 Extraindo dados do Certificado A1...\n');
    
    const resultado = CertificadoExtractor.extrairDados(certPath, senha);
    
    if (resultado.success) {
        const d = resultado.dados;
        console.log('✅ Certificado lido com sucesso!\n');
        console.log('📋 DADOS DA EMPRESA:');
        console.log('─'.repeat(50));
        console.log(`   CNPJ:          ${d.cnpj || 'Não encontrado'}`);
        console.log(`   Razão Social:  ${d.razaoSocial || 'Não encontrado'}`);
        console.log(`   UF:            ${d.uf || 'Não encontrado'}`);
        console.log('');
        console.log('📅 VALIDADE:');
        console.log('─'.repeat(50));
        console.log(`   Início:        ${new Date(d.validadeInicio).toLocaleDateString('pt-BR')}`);
        console.log(`   Fim:           ${new Date(d.validadeFim).toLocaleDateString('pt-BR')}`);
        console.log(`   Dias restantes: ${d.diasRestantes}`);
        console.log(`   Status:        ${d.vencido ? '❌ VENCIDO' : (d.proximoVencimento ? '⚠️ PRÓXIMO DO VENCIMENTO' : '✅ VÁLIDO')}`);
        console.log('');
        console.log('🏢 CERTIFICADORA:');
        console.log('─'.repeat(50));
        console.log(`   ${d.certificadora || 'Não identificada'}`);
        console.log('');
    } else {
        console.log('❌ Erro ao ler certificado:', resultado.error);
        console.log('');
        console.log('Possíveis causas:');
        console.log('  - Senha incorreta');
        console.log('  - Arquivo corrompido');
        console.log('  - Formato não suportado');
    }
}

module.exports = CertificadoExtractor;
