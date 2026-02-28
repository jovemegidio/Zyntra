/**
 * CONFIGURAÇÕES NFe - SEFAZ
 * Configurações para integração com SEFAZ e emissão de NF-e
 */

module.exports = {
    // Ambiente (1 = Produção, 2 = Homologação)
    ambiente: process.env.NFE_AMBIENTE || 2,
    
    // Versão do layout NFe
    versao: '4.00',
    
    // Estados suportados
    estados: {
        'AC': { codigo: 12, nome: 'Acre' },
        'AL': { codigo: 27, nome: 'Alagoas' },
        'AM': { codigo: 13, nome: 'Amazonas' },
        'AP': { codigo: 16, nome: 'Amapá' },
        'BA': { codigo: 29, nome: 'Bahia' },
        'CE': { codigo: 23, nome: 'Ceará' },
        'DF': { codigo: 53, nome: 'Distrito Federal' },
        'ES': { codigo: 32, nome: 'Espírito Santo' },
        'GO': { codigo: 52, nome: 'Goiás' },
        'MA': { codigo: 21, nome: 'Maranhão' },
        'MG': { codigo: 31, nome: 'Minas Gerais' },
        'MS': { codigo: 50, nome: 'Mato Grosso do Sul' },
        'MT': { codigo: 51, nome: 'Mato Grosso' },
        'PA': { codigo: 15, nome: 'Pará' },
        'PB': { codigo: 25, nome: 'Paraíba' },
        'PE': { codigo: 26, nome: 'Pernambuco' },
        'PI': { codigo: 22, nome: 'Piauí' },
        'PR': { codigo: 41, nome: 'Paraná' },
        'RJ': { codigo: 33, nome: 'Rio de Janeiro' },
        'RN': { codigo: 24, nome: 'Rio Grande do Norte' },
        'RO': { codigo: 11, nome: 'Rondônia' },
        'RR': { codigo: 14, nome: 'Roraima' },
        'RS': { codigo: 43, nome: 'Rio Grande do Sul' },
        'SC': { codigo: 42, nome: 'Santa Catarina' },
        'SE': { codigo: 28, nome: 'Sergipe' },
        'SP': { codigo: 35, nome: 'São Paulo' },
        'TO': { codigo: 17, nome: 'Tocantins' }
    },
    
    // Webservices SEFAZ por UF — TODOS os autorizadores (homologação + produção)
    webservices: {
        homologacao: {
            'SP': {
                autorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
                retAutorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
                consulta: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
                statusServico: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
                inutilizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
                eventos: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx'
            },
            'MG': {
                autorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
                retAutorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
                consulta: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
                statusServico: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
                inutilizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
                eventos: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4'
            },
            'AM': {
                autorizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
                retAutorizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
                consulta: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
                statusServico: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
                inutilizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
                eventos: 'https://homnfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4'
            },
            'BA': {
                autorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
                consulta: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
                statusServico: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
                inutilizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
                eventos: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
            },
            'CE': {
                autorizacao: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeAutorizacao4',
                retAutorizacao: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeRetAutorizacao4',
                consulta: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeConsultaProtocolo4',
                statusServico: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeStatusServico4',
                inutilizacao: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeInutilizacao4',
                eventos: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeRecepcaoEvento4'
            },
            'GO': {
                autorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
                retAutorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4',
                consulta: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
                statusServico: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4',
                inutilizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
                eventos: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4'
            },
            'MS': {
                autorizacao: 'https://homologacao.nfe.ms.gov.br/ws/NFeAutorizacao4',
                retAutorizacao: 'https://homologacao.nfe.ms.gov.br/ws/NFeRetAutorizacao4',
                consulta: 'https://homologacao.nfe.ms.gov.br/ws/NFeConsultaProtocolo4',
                statusServico: 'https://homologacao.nfe.ms.gov.br/ws/NFeStatusServico4',
                inutilizacao: 'https://homologacao.nfe.ms.gov.br/ws/NFeInutilizacao4',
                eventos: 'https://homologacao.nfe.ms.gov.br/ws/NFeRecepcaoEvento4'
            },
            'MT': {
                autorizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
                retAutorizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4',
                consulta: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
                statusServico: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
                inutilizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
                eventos: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4'
            },
            'PE': {
                autorizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4',
                retAutorizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4',
                consulta: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsulta4',
                statusServico: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
                inutilizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4',
                eventos: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/RecepcaoEvento4'
            },
            'PR': {
                autorizacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
                retAutorizacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4',
                consulta: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
                statusServico: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4',
                inutilizacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4',
                eventos: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4'
            },
            'RS': {
                autorizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
                consulta: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
                statusServico: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
                inutilizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
                eventos: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/RecepcaoEvento/RecepcaoEvento4.asmx'
            },
            'SVAN': { // SEFAZ Virtual do Ambiente Nacional (MA, PA, PI)
                autorizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
                consulta: 'https://hom.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
                statusServico: 'https://hom.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
                inutilizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
                eventos: 'https://hom.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
            },
            'SVRS': { // SEFAZ Virtual RS (AC, AL, AP, DF, ES, PB, RJ, RN, RO, RR, SC, SE, TO)
                autorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
                consulta: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
                statusServico: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
                inutilizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
                eventos: 'https://nfe-homologacao.svrs.rs.gov.br/ws/RecepcaoEvento/RecepcaoEvento4.asmx'
            }
        },
        producao: {
            'SP': {
                autorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
                retAutorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
                consulta: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
                statusServico: 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
                inutilizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
                eventos: 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx'
            },
            'MG': {
                autorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
                retAutorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
                consulta: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
                statusServico: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
                inutilizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
                eventos: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4'
            },
            'AM': {
                autorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
                retAutorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
                consulta: 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
                statusServico: 'https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
                inutilizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
                eventos: 'https://nfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4'
            },
            'BA': {
                autorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
                consulta: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
                statusServico: 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
                inutilizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
                eventos: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
            },
            'CE': {
                autorizacao: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeAutorizacao4',
                retAutorizacao: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeRetAutorizacao4',
                consulta: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeConsultaProtocolo4',
                statusServico: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeStatusServico4',
                inutilizacao: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeInutilizacao4',
                eventos: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeRecepcaoEvento4'
            },
            'GO': {
                autorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
                retAutorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4',
                consulta: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
                statusServico: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4',
                inutilizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
                eventos: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4'
            },
            'MS': {
                autorizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4',
                retAutorizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4',
                consulta: 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
                statusServico: 'https://nfe.sefaz.ms.gov.br/ws/NFeStatusServico4',
                inutilizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4',
                eventos: 'https://nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4'
            },
            'MT': {
                autorizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
                retAutorizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4',
                consulta: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
                statusServico: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
                inutilizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
                eventos: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4'
            },
            'PE': {
                autorizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4',
                retAutorizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4',
                consulta: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsulta4',
                statusServico: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
                inutilizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4',
                eventos: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/RecepcaoEvento4'
            },
            'PR': {
                autorizacao: 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
                retAutorizacao: 'https://nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4',
                consulta: 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
                statusServico: 'https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4',
                inutilizacao: 'https://nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4',
                eventos: 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4'
            },
            'RS': {
                autorizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
                consulta: 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
                statusServico: 'https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
                inutilizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
                eventos: 'https://nfe.sefazrs.rs.gov.br/ws/RecepcaoEvento/RecepcaoEvento4.asmx'
            },
            'SVAN': { // SEFAZ Virtual do Ambiente Nacional (MA, PA, PI)
                autorizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
                consulta: 'https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
                statusServico: 'https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
                inutilizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
                eventos: 'https://www.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
            },
            'SVRS': { // SEFAZ Virtual RS (AC, AL, AP, DF, ES, PB, RJ, RN, RO, RR, SC, SE, TO)
                autorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
                retAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
                consulta: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
                statusServico: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
                inutilizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
                eventos: 'https://nfe.svrs.rs.gov.br/ws/RecepcaoEvento/RecepcaoEvento4.asmx'
            }
        }
    },
    
    // Mapeamento de estados para autorizadores
    autorizadores: {
        'AC': 'SVRS', 'AL': 'SVRS', 'AM': 'AM', 'AP': 'SVRS', 'BA': 'BA',
        'CE': 'CE', 'DF': 'SVRS', 'ES': 'SVRS', 'GO': 'GO', 'MA': 'SVAN',
        'MG': 'MG', 'MS': 'MS', 'MT': 'MT', 'PA': 'SVAN', 'PB': 'SVRS',
        'PE': 'PE', 'PI': 'SVAN', 'PR': 'PR', 'RJ': 'SVRS', 'RN': 'SVRS',
        'RO': 'SVRS', 'RR': 'SVRS', 'RS': 'RS', 'SC': 'SVRS', 'SE': 'SVRS',
        'SP': 'SP', 'TO': 'SVRS'
    },
    
    // Tipos de emissão
    tiposEmissao: {
        NORMAL: 1,
        CONTINGENCIA_FS_IA: 2,
        CONTINGENCIA_SCAN: 3,
        CONTINGENCIA_DPEC: 4,
        CONTINGENCIA_FS_DA: 5,
        CONTINGENCIA_SVC_AN: 6,
        CONTINGENCIA_SVC_RS: 7,
        CONTINGENCIA_OFFLINE: 9
    },
    
    // Modelos de documento
    modelos: {
        NFE: '55',
        NFCE: '65'
    },
    
    // Finalidades
    finalidades: {
        NORMAL: 1,
        COMPLEMENTAR: 2,
        AJUSTE: 3,
        DEVOLUCAO: 4
    },
    
    // Tipos de operação
    tiposOperacao: {
        ENTRADA: 0,
        SAIDA: 1
    },
    
    // Indicador de presença
    indicadoresPresenca: {
        NAO_SE_APLICA: 0,
        PRESENCIAL: 1,
        INTERNET: 2,
        TELEATENDIMENTO: 3,
        ENTREGA_DOMICILIO: 4,
        PRESENCIAL_FORA: 9
    },
    
    // Timeout para requisições SEFAZ (ms)
    timeout: 30000,
    
    // Diretórios de armazenamento
    diretorios: {
        xmls: process.env.NFE_XML_DIR || './storage/nfe/xmls',
        temporarios: process.env.NFE_TEMP_DIR || './storage/nfe/temp',
        backups: process.env.NFE_BACKUP_DIR || './storage/nfe/backups',
        danfes: process.env.NFE_DANFE_DIR || './storage/nfe/danfes',
        certificados: process.env.NFE_CERT_DIR || './storage/nfe/certificados'
    }
};
