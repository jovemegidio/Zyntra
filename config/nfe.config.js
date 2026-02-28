// =================================================================
// CONFIGURAÇáO NFe - ALUFORCE v2.0
// =================================================================

module.exports = {
    // Ambiente: 1 = Produção, 2 = Homologação
    ambiente: 2,
    
    // Dados do Emitente
    emitente: {
        cnpj: process.env.NFE_CNPJ || '',
        inscricaoEstadual: process.env.NFE_IE || '',
        razaoSocial: process.env.NFE_RAZAO_SOCIAL || 'ALUFORCE INDUSTRIA E COMERCIO LTDA',
        nomeFantasia: process.env.NFE_NOME_FANTASIA || 'ALUFORCE',
        endereco: {
            logradouro: process.env.NFE_LOGRADOURO || '',
            numero: process.env.NFE_NUMERO || '',
            bairro: process.env.NFE_BAIRRO || '',
            cep: process.env.NFE_CEP || '',
            municipio: process.env.NFE_MUNICIPIO || '',
            codigoMunicipio: process.env.NFE_COD_MUNICIPIO || '',
            uf: process.env.NFE_UF || 'SP',
            pais: 'BRASIL',
            codigoPais: '1058'
        },
        telefone: process.env.NFE_TELEFONE || '',
        email: process.env.NFE_EMAIL || ''
    },
    
    // Certificado Digital
    certificado: {
        arquivo: process.env.NFE_CERT_PATH || '',
        senha: process.env.NFE_CERT_SENHA || ''
    },
    
    // Configurações de Série e Numeração
    serie: {
        nfe: 1,
        nfce: 1
    },
    
    // URLs dos WebServices (Homologação - SP)
    webservices: {
        autorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
        retAutorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
        inutilizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
        consulta: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
        status: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
        evento: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx'
    },
    
    // Configurações de Timeout
    timeout: 60000,
    
    // Configurações de Retry
    retry: {
        maxAttempts: 3,
        delay: 5000
    },
    
    // Diretórios
    diretorios: {
        xml: './storage/nfe/xml',
        pdf: './storage/nfe/pdf',
        certificados: './storage/certificados'
    }
};
