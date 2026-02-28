/**
 * CONFIGURAÇÕES TRIBUTÁRIAS
 * Tabelas e regras para cálculo de impostos
 */

module.exports = {
    // Regimes Tributários
    regimesTributarios: {
        SIMPLES_NACIONAL: 1,
        SIMPLES_EXCESSO: 2,
        REGIME_NORMAL: 3
    },
    
    // Alíquotas ICMS por UF (internas)
    aliquotasICMS: {
        'AC': 17, 'AL': 18, 'AM': 18, 'AP': 18, 'BA': 18,
        'CE': 18, 'DF': 18, 'ES': 17, 'GO': 17, 'MA': 18,
        'MG': 18, 'MS': 17, 'MT': 17, 'PA': 17, 'PB': 18,
        'PE': 18, 'PI': 18, 'PR': 18, 'RJ': 20, 'RN': 18,
        'RO': 17.5, 'RR': 17, 'RS': 18, 'SC': 17, 'SE': 18,
        'SP': 18, 'TO': 18
    },
    
    // Alíquota interestadual
    aliquotasInterestaduais: {
        // Sul e Sudeste (exceto ES) para Norte, Nordeste, Centro-Oeste e ES
        regiaoOrigem: {
            'SUL_SUDESTE': {
                'NORTE_NORDESTE_CO': 7,
                'SUL_SUDESTE': 12
            }
        },
        // Casos especiais
        importados: 4
    },
    
    // CST - Código de Situação Tributária (ICMS)
    cstICMS: {
        '00': 'Tributada integralmente',
        '10': 'Tributada e com cobrança do ICMS por substituição tributária',
        '20': 'Com redução de base de cálculo',
        '30': 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
        '40': 'Isenta',
        '41': 'Não tributada',
        '50': 'Suspensão',
        '51': 'Diferimento',
        '60': 'ICMS cobrado anteriormente por substituição tributária',
        '70': 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária',
        '90': 'Outras'
    },
    
    // CSOSN - Código de Situação da Operação no Simples Nacional
    csosnSimples: {
        '101': 'Tributada pelo Simples Nacional com permissão de crédito',
        '102': 'Tributada pelo Simples Nacional sem permissão de crédito',
        '103': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta',
        '201': 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária',
        '202': 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária',
        '203': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária',
        '300': 'Imune',
        '400': 'Não tributada pelo Simples Nacional',
        '500': 'ICMS cobrado anteriormente por substituição tributária ou por antecipação',
        '900': 'Outros'
    },
    
    // CST PIS/COFINS
    cstPIS: {
        '01': 'Operação Tributável com Alíquota Básica',
        '02': 'Operação Tributável com Alíquota Diferenciada',
        '03': 'Operação Tributável com Alíquota por Unidade de Medida de Produto',
        '04': 'Operação Tributável Monofásica - Revenda a Alíquota Zero',
        '05': 'Operação Tributável por Substituição Tributária',
        '06': 'Operação Tributável a Alíquota Zero',
        '07': 'Operação Isenta da Contribuição',
        '08': 'Operação sem Incidência da Contribuição',
        '09': 'Operação com Suspensão da Contribuição',
        '49': 'Outras Operações de Saída',
        '50': 'Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
        '51': 'Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Não Tributada no Mercado Interno',
        '52': 'Operação com Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação',
        '53': 'Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
        '54': 'Operação com Direito a Crédito - Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
        '55': 'Operação com Direito a Crédito - Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
        '56': 'Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação',
        '60': 'Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
        '61': 'Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno',
        '62': 'Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita de Exportação',
        '63': 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
        '64': 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
        '65': 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
        '66': 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação',
        '67': 'Crédito Presumido - Outras Operações',
        '70': 'Operação de Aquisição sem Direito a Crédito',
        '71': 'Operação de Aquisição com Isenção',
        '72': 'Operação de Aquisição com Suspensão',
        '73': 'Operação de Aquisição a Alíquota Zero',
        '74': 'Operação de Aquisição sem Incidência da Contribuição',
        '75': 'Operação de Aquisição por Substituição Tributária',
        '98': 'Outras Operações de Entrada',
        '99': 'Outras Operações'
    },
    
    // Alíquotas PIS/COFINS (regime não cumulativo)
    aliquotasPIS: {
        regimeCumulativo: 0.0065,      // 0,65%
        regimeNaoCumulativo: 0.0165     // 1,65%
    },
    
    aliquotasCOFINS: {
        regimeCumulativo: 0.03,         // 3%
        regimeNaoCumulativo: 0.076      // 7,6%
    },
    
    // CST IPI
    cstIPI: {
        '00': 'Entrada com recuperação de crédito',
        '01': 'Entrada tributada com alíquota zero',
        '02': 'Entrada isenta',
        '03': 'Entrada não-tributada',
        '04': 'Entrada imune',
        '05': 'Entrada com suspensão',
        '49': 'Outras entradas',
        '50': 'Saída tributada',
        '51': 'Saída tributada com alíquota zero',
        '52': 'Saída isenta',
        '53': 'Saída não-tributada',
        '54': 'Saída imune',
        '55': 'Saída com suspensão',
        '99': 'Outras saídas'
    },
    
    // CFOP - Código Fiscal de Operações e Prestações
    cfop: {
        // Entradas
        '1101': 'Compra para industrialização',
        '1102': 'Compra para comercialização',
        '1201': 'Devolução de venda de produção do estabelecimento',
        '1202': 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
        '1411': 'Devolução de venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária',
        
        // Saídas dentro do estado
        '5101': 'Venda de produção do estabelecimento',
        '5102': 'Venda de mercadoria adquirida ou recebida de terceiros',
        '5103': 'Venda de produção do estabelecimento, efetuada fora do estabelecimento',
        '5104': 'Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento',
        '5405': 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária',
        '5201': 'Devolução de compra para industrialização',
        '5202': 'Devolução de compra para comercialização',
        '5949': 'Outra saída de mercadoria ou prestação de serviço não especificado',
        
        // Saídas interestaduais
        '6101': 'Venda de produção do estabelecimento',
        '6102': 'Venda de mercadoria adquirida ou recebida de terceiros',
        '6103': 'Venda de produção do estabelecimento, efetuada fora do estabelecimento',
        '6104': 'Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento',
        '6201': 'Devolução de compra para industrialização',
        '6202': 'Devolução de compra para comercialização',
        '6949': 'Outra saída de mercadoria ou prestação de serviço não especificado',
        
        // Exportação
        '7101': 'Venda de produção do estabelecimento',
        '7102': 'Venda de mercadoria adquirida ou recebida de terceiros'
    },
    
    // Modalidade de determinação da BC do ICMS
    modalidadesBC: {
        MARGEM_VALOR_AGREGADO: 0,
        PAUTA: 1,
        PRECO_TABELADO_MAX: 2,
        VALOR_OPERACAO: 3
    },
    
    // Modalidade de determinação da BC do ICMS ST
    modalidadesBCST: {
        PRECO_TABELADO_MAX: 0,
        LISTA_NEGATIVA: 1,
        LISTA_POSITIVA: 2,
        LISTA_NEUTRA: 3,
        MARGEM_VALOR_AGREGADO: 4,
        PAUTA: 5
    },
    
    // FCP - Fundo de Combate à Pobreza (% adicional)
    aliquotasFCP: {
        'AC': 2, 'AL': 2, 'AM': 0, 'AP': 0, 'BA': 2,
        'CE': 2, 'DF': 0, 'ES': 0, 'GO': 0, 'MA': 2,
        'MG': 2, 'MS': 2, 'MT': 0, 'PA': 2, 'PB': 2,
        'PE': 2, 'PI': 0, 'PR': 2, 'RJ': 2, 'RN': 2,
        'RO': 0, 'RR': 0, 'RS': 2, 'SC': 0, 'SE': 2,
        'SP': 2, 'TO': 0
    }
};
