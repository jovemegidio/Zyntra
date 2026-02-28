/**
 * SERVIÇO DE CÁLCULO IBS/CBS — Reforma Tributária
 * Conforme NT 2025.002 / Ato Conjunto RFB/CGIBS nº 01/2025
 * 
 * IBS = Imposto sobre Bens e Serviços (estadual+municipal, substitui ICMS/ISS)
 * CBS = Contribuição sobre Bens e Serviços (federal, substitui PIS/COFINS)
 * 
 * Cronograma de transição:
 *   2026: IBS 10% + ICMS 90%
 *   2027-2032: Crescimento gradual IBS
 *   2033: IBS 100%, ICMS extinto
 * 
 * @version 1.0.0
 * @date 2026-02-23
 */

'use strict';

const { Decimal } = require('./calculo-tributos.service');

// ============================================================
// ALÍQUOTAS DE REFERÊNCIA (Lei Complementar 214/2025)
// ============================================================

const ALIQUOTAS_REFERENCIA = {
    CBS: {
        padrao: 8.80,           // Alíquota cheia CBS
        reduzida_60: 3.52,      // 60% de redução
        reduzida_30: 6.16,      // 30% de redução
    },
    IBS: {
        padrao: 17.70,          // Alíquota cheia IBS
        reduzida_60: 7.08,      // 60% de redução
        reduzida_30: 12.39,     // 30% de redução
    }
};

// Cronograma de transição IBS↔ICMS (hardcoded como fallback)
const CRONOGRAMA_TRANSICAO = {
    2026: { ibs: 10, icms: 90 },
    2027: { ibs: 20, icms: 80 },
    2028: { ibs: 30, icms: 70 },
    2029: { ibs: 40, icms: 60 },
    2030: { ibs: 50, icms: 50 },
    2031: { ibs: 60, icms: 40 },
    2032: { ibs: 80, icms: 20 },
    2033: { ibs: 100, icms: 0 },
};

class IBSCBSService {

    /**
     * Verifica se IBS/CBS está ativo na configuração da empresa
     */
    static async isAtivo() {
        try {
            if (global.dbPool) {
                const [rows] = await global.dbPool.query(
                    'SELECT ibs_cbs_ativo, ibs_cbs_modo, regime_tributario FROM empresa_config WHERE id = 1'
                );
                if (rows.length > 0) {
                    return {
                        ativo: !!rows[0].ibs_cbs_ativo,
                        modo: rows[0].ibs_cbs_modo || 'transicao',
                        regime: rows[0].regime_tributario || 'simples'
                    };
                }
            }
            return { ativo: false, modo: 'transicao', regime: 'simples' };
        } catch (error) {
            console.error('[IBS/CBS] Erro ao verificar status:', error.message);
            return { ativo: false, modo: 'transicao', regime: 'simples' };
        }
    }

    /**
     * Obtém percentuais de transição IBS↔ICMS para o ano corrente
     */
    static async getPercentuaisTransicao(ano = null) {
        const anoRef = ano || new Date().getFullYear();

        // Tentar buscar do banco
        try {
            if (global.dbPool) {
                const [rows] = await global.dbPool.query(
                    'SELECT percentual_ibs, percentual_icms FROM transicao_ibs_icms_cronograma WHERE ano = ?',
                    [anoRef]
                );
                if (rows.length > 0) {
                    return {
                        ano: anoRef,
                        percentualIBS: parseFloat(rows[0].percentual_ibs),
                        percentualICMS: parseFloat(rows[0].percentual_icms)
                    };
                }
            }
        } catch (e) {
            // Fallback para tabela hardcoded
        }

        // Fallback
        const transicao = CRONOGRAMA_TRANSICAO[anoRef];
        if (transicao) {
            return {
                ano: anoRef,
                percentualIBS: transicao.ibs,
                percentualICMS: transicao.icms
            };
        }

        // Antes de 2026 ou depois de 2033
        if (anoRef < 2026) return { ano: anoRef, percentualIBS: 0, percentualICMS: 100 };
        return { ano: anoRef, percentualIBS: 100, percentualICMS: 0 };
    }

    /**
     * Resolve a alíquota de classificação tributária
     * @param {string} classeTributaria — código cClassTrib (ex: 'CBS-001')
     * @param {string} tipo — 'CBS' ou 'IBS'
     */
    static async resolverAliquota(classeTributaria, tipo) {
        if (!classeTributaria) {
            return tipo === 'CBS' ? ALIQUOTAS_REFERENCIA.CBS.padrao : ALIQUOTAS_REFERENCIA.IBS.padrao;
        }

        // Tentar buscar do banco
        try {
            if (global.dbPool) {
                const [rows] = await global.dbPool.query(
                    'SELECT aliquota_referencia FROM classificacao_tributaria_ibs_cbs WHERE codigo = ? AND tipo = ? AND ativo = TRUE',
                    [classeTributaria, tipo]
                );
                if (rows.length > 0 && rows[0].aliquota_referencia != null) {
                    return parseFloat(rows[0].aliquota_referencia);
                }
            }
        } catch (e) {
            // fallback
        }

        // Fallback por padrão de código
        if (classeTributaria.includes('002')) {
            return tipo === 'CBS' ? ALIQUOTAS_REFERENCIA.CBS.reduzida_60 : ALIQUOTAS_REFERENCIA.IBS.reduzida_60;
        }
        if (classeTributaria.includes('003')) {
            return tipo === 'CBS' ? ALIQUOTAS_REFERENCIA.CBS.reduzida_30 : ALIQUOTAS_REFERENCIA.IBS.reduzida_30;
        }
        if (['004', '005', '006', '007'].some(s => classeTributaria.includes(s))) {
            return 0;
        }

        return tipo === 'CBS' ? ALIQUOTAS_REFERENCIA.CBS.padrao : ALIQUOTAS_REFERENCIA.IBS.padrao;
    }

    /**
     * Calcula IBS e CBS para um item da NF-e.
     * Usa Decimal para precisão exata (mesma classe do calculo-tributos.service).
     * 
     * @param {Object} item — item do pedido (precisa ter classe_tributaria_ibs, classe_tributaria_cbs)
     * @param {Decimal|number} valorProduto — valor da base de cálculo
     * @param {Object} options — { modo: 'transicao'|'pleno', ano: 2026 }
     * @returns {Object} { cbs: {...}, ibs: {...}, transicao: {...} }
     */
    static async calcularIBSCBS(item, valorProduto, options = {}) {
        const modo = options.modo || 'transicao';
        const base = Decimal.from(valorProduto);

        const resultado = {
            cbs: {
                cClassTrib: item.classe_tributaria_cbs || null,
                baseCalculo: 0,
                aliquota: 0,
                valor: 0
            },
            ibs: {
                cClassTrib: item.classe_tributaria_ibs || null,
                baseCalculo: 0,
                aliquota: 0,
                valor: 0
            },
            transicao: null
        };

        // CBS
        const aliqCBS = Decimal.from(await this.resolverAliquota(item.classe_tributaria_cbs, 'CBS'));
        if (aliqCBS.isPositive()) {
            resultado.cbs.baseCalculo = parseFloat(base.toFixed(2));
            resultado.cbs.aliquota = aliqCBS.toNumber();
            resultado.cbs.valor = parseFloat(base.percent(aliqCBS).toFixed(2));
        }

        // IBS
        const aliqIBS = Decimal.from(await this.resolverAliquota(item.classe_tributaria_ibs, 'IBS'));
        if (aliqIBS.isPositive()) {
            resultado.ibs.baseCalculo = parseFloat(base.toFixed(2));
            resultado.ibs.aliquota = aliqIBS.toNumber();
            resultado.ibs.valor = parseFloat(base.percent(aliqIBS).toFixed(2));
        }

        // Período de transição: calcular proporção IBS↔ICMS
        if (modo === 'transicao') {
            const transicao = await this.getPercentuaisTransicao(options.ano);
            const fatorIBS = Decimal.from(transicao.percentualIBS).div(Decimal.from(100));
            const fatorICMS = Decimal.from(transicao.percentualICMS).div(Decimal.from(100));

            resultado.transicao = {
                ano: transicao.ano,
                percentualIBS: transicao.percentualIBS,
                percentualICMS: transicao.percentualICMS,
                ibsEfetivo: parseFloat(Decimal.from(resultado.ibs.valor).mul(fatorIBS).toFixed(2)),
                icmsResidual: parseFloat(Decimal.from(resultado.ibs.valor).mul(fatorICMS).toFixed(2))
            };
        }

        return resultado;
    }

    /**
     * Gera os nós XML <IBS> e <CBS> para um item (grupo imposto)
     * Conforme NT 2025.002 v1.40
     * 
     * @param {Object} impostoNode — nó XML <imposto> do xmlbuilder2
     * @param {Object} ibsCbsCalc — resultado de calcularIBSCBS()
     */
    static adicionarXMLIBSCBS(impostoNode, ibsCbsCalc) {
        if (!ibsCbsCalc) return;

        // <CBS> — Contribuição sobre Bens e Serviços (Federal)
        if (ibsCbsCalc.cbs && ibsCbsCalc.cbs.cClassTrib) {
            const cbs = impostoNode.ele('CBS');
            cbs.ele('cClassTrib').txt(ibsCbsCalc.cbs.cClassTrib);
            if (ibsCbsCalc.cbs.valor > 0) {
                cbs.ele('vBC').txt(Decimal.from(ibsCbsCalc.cbs.baseCalculo).toFixed(2));
                cbs.ele('pCBS').txt(Decimal.from(ibsCbsCalc.cbs.aliquota).toFixed(4));
                cbs.ele('vCBS').txt(Decimal.from(ibsCbsCalc.cbs.valor).toFixed(2));
            }
            cbs.up();
        }

        // <IBS> — Imposto sobre Bens e Serviços (Estadual+Municipal)
        if (ibsCbsCalc.ibs && ibsCbsCalc.ibs.cClassTrib) {
            const ibs = impostoNode.ele('IBS');
            ibs.ele('cClassTrib').txt(ibsCbsCalc.ibs.cClassTrib);
            if (ibsCbsCalc.ibs.valor > 0) {
                ibs.ele('vBC').txt(Decimal.from(ibsCbsCalc.ibs.baseCalculo).toFixed(2));
                ibs.ele('pIBS').txt(Decimal.from(ibsCbsCalc.ibs.aliquota).toFixed(4));
                ibs.ele('vIBS').txt(Decimal.from(ibsCbsCalc.ibs.valor).toFixed(2));
            }
            // Período de transição
            if (ibsCbsCalc.transicao) {
                ibs.ele('pIBSEfetivo').txt(Decimal.from(ibsCbsCalc.transicao.percentualIBS).toFixed(2));
                ibs.ele('vIBSEfetivo').txt(Decimal.from(ibsCbsCalc.transicao.ibsEfetivo).toFixed(2));
                ibs.ele('vICMSResidual').txt(Decimal.from(ibsCbsCalc.transicao.icmsResidual).toFixed(2));
            }
            ibs.up();
        }
    }

    /**
     * Gera os totais IBS/CBS para ICMSTot
     * @param {Array} itensCalculados — array de resultados de calcularIBSCBS
     * @returns {Object} { totalCBS, totalIBS, totalIBSEfetivo, totalICMSResidual }
     */
    static totalizarIBSCBS(itensCalculados) {
        let totalCBS = Decimal.from(0);
        let totalIBS = Decimal.from(0);
        let totalIBSEfetivo = Decimal.from(0);
        let totalICMSResidual = Decimal.from(0);

        for (const calc of itensCalculados) {
            if (!calc) continue;
            totalCBS = totalCBS.add(Decimal.from(calc.cbs?.valor || 0));
            totalIBS = totalIBS.add(Decimal.from(calc.ibs?.valor || 0));
            if (calc.transicao) {
                totalIBSEfetivo = totalIBSEfetivo.add(Decimal.from(calc.transicao.ibsEfetivo || 0));
                totalICMSResidual = totalICMSResidual.add(Decimal.from(calc.transicao.icmsResidual || 0));
            }
        }

        return {
            totalCBS: parseFloat(totalCBS.toFixed(2)),
            totalIBS: parseFloat(totalIBS.toFixed(2)),
            totalIBSEfetivo: parseFloat(totalIBSEfetivo.toFixed(2)),
            totalICMSResidual: parseFloat(totalICMSResidual.toFixed(2))
        };
    }
}

module.exports = IBSCBSService;
module.exports.ALIQUOTAS_REFERENCIA = ALIQUOTAS_REFERENCIA;
module.exports.CRONOGRAMA_TRANSICAO = CRONOGRAMA_TRANSICAO;
