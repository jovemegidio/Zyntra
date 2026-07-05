'use strict';

const { Decimal } = require('./calculo-tributos.service');
const ReformaTributariaService = require('../../../services/reforma-tributaria.service');

const ALIQUOTAS_REFERENCIA = {
    CBS: {
        teste_2026: 0.9,
        padrao: 0.9,
        reduzida_60: 0.36,
        reduzida_30: 0.63
    },
    IBS: {
        teste_2026: 0.1,
        padrao: 0.1,
        reduzida_60: 0.04,
        reduzida_30: 0.07
    },
    IS: {
        padrao: 0
    }
};

const CRONOGRAMA_TRANSICAO = ReformaTributariaService.CRONOGRAMA_IBS_ICMS;

function getPool(options = {}) {
    return options.pool || global.dbPool || null;
}

function getDefaultAliquota(tipo) {
    const upper = String(tipo || '').toUpperCase();
    if (upper === 'IBS') return ALIQUOTAS_REFERENCIA.IBS.padrao;
    if (upper === 'IS') return ALIQUOTAS_REFERENCIA.IS.padrao;
    return ALIQUOTAS_REFERENCIA.CBS.padrao;
}

class IBSCBSService {
    static async isAtivo(options = {}) {
        try {
            const pool = getPool(options);
            if (!pool) return { ativo: false, modo: 'homologacao_2026', regime: 'simples' };
            const cfg = await ReformaTributariaService.getConfig(pool);
            return {
                ativo: !!cfg.destacar_documentos,
                modo: cfg.modo_calculo || 'homologacao_2026',
                regime: options.regime || 'simples',
                config: cfg
            };
        } catch (error) {
            console.error('[IBS/CBS] Erro ao verificar status:', error.message);
            return { ativo: false, modo: 'homologacao_2026', regime: 'simples' };
        }
    }

    static async getPercentuaisTransicao(ano = null) {
        const data = ano ? `${ano}-01-01` : undefined;
        const t = ReformaTributariaService.getPercentuaisTransicao(data);
        return {
            ano: t.ano,
            percentualIBS: t.percentualIBS,
            percentualICMS: t.percentualICMS
        };
    }

    static async resolverAliquota(classeTributaria, tipo, options = {}) {
        const upper = String(tipo || 'CBS').toUpperCase();
        const pool = getPool(options);

        if (pool) {
            try {
                const regra = await ReformaTributariaService.resolveRegra(pool, {
                    tributo: upper,
                    data: options.data,
                    ncm: options.ncm,
                    uf: options.uf,
                    cclasstrib: classeTributaria
                });
                if (regra && regra.aliquota != null) return parseFloat(regra.aliquota);
            } catch (_) {
                // Fallback abaixo.
            }

            try {
                const [rows] = await pool.query(
                    'SELECT aliquota_referencia FROM classificacao_tributaria_ibs_cbs WHERE codigo = ? AND tipo = ? AND ativo = TRUE',
                    [classeTributaria, upper]
                );
                if (rows.length > 0 && rows[0].aliquota_referencia != null) {
                    return parseFloat(rows[0].aliquota_referencia);
                }
            } catch (_) {
                // Fallback abaixo.
            }
        }

        if (!classeTributaria) return getDefaultAliquota(upper);
        const classe = String(classeTributaria);
        if (classe.includes('002')) {
            return upper === 'CBS' ? ALIQUOTAS_REFERENCIA.CBS.reduzida_60 : ALIQUOTAS_REFERENCIA.IBS.reduzida_60;
        }
        if (classe.includes('003')) {
            return upper === 'CBS' ? ALIQUOTAS_REFERENCIA.CBS.reduzida_30 : ALIQUOTAS_REFERENCIA.IBS.reduzida_30;
        }
        if (['004', '005', '006', '007'].some(s => classe.includes(s))) return 0;
        return getDefaultAliquota(upper);
    }

    static async calcularIBSCBS(item, valorProduto, options = {}) {
        const pool = getPool(options);
        const data = options.data || options.data_referencia || (options.ano ? `${options.ano}-01-01` : undefined);

        if (pool) {
            const calc = await ReformaTributariaService.calcularItem(pool, item, {
                ...options,
                data,
                base: valorProduto
            });
            return this.normalizarResultado(calc);
        }

        const base = Decimal.from(valorProduto);
        const aliqCBS = Decimal.from(await this.resolverAliquota(item.classe_tributaria_cbs, 'CBS', options));
        const aliqIBS = Decimal.from(await this.resolverAliquota(item.classe_tributaria_ibs, 'IBS', options));
        const aliqIS = Decimal.from(await this.resolverAliquota(item.classe_tributaria_is, 'IS', options));
        const cbsValor = parseFloat(base.percent(aliqCBS).toFixed(2));
        const ibsValor = parseFloat(base.percent(aliqIBS).toFixed(2));
        const isValor = parseFloat(base.percent(aliqIS).toFixed(2));
        const transicao = await this.getPercentuaisTransicao(options.ano);
        const fatorIBS = Decimal.from(transicao.percentualIBS).div(100);
        const fatorICMS = Decimal.from(transicao.percentualICMS).div(100);

        return {
            cbs: {
                cClassTrib: item.classe_tributaria_cbs || null,
                baseCalculo: parseFloat(base.toFixed(2)),
                aliquota: aliqCBS.toNumber(),
                valor: cbsValor
            },
            ibs: {
                cClassTrib: item.classe_tributaria_ibs || null,
                baseCalculo: parseFloat(base.toFixed(2)),
                aliquota: aliqIBS.toNumber(),
                valor: ibsValor
            },
            imposto_seletivo: {
                cClassTrib: item.classe_tributaria_is || null,
                baseCalculo: parseFloat(base.toFixed(2)),
                aliquota: aliqIS.toNumber(),
                valor: isValor
            },
            transicao: {
                ano: transicao.ano,
                percentualIBS: transicao.percentualIBS,
                percentualICMS: transicao.percentualICMS,
                ibsEfetivo: parseFloat(Decimal.from(ibsValor).mul(fatorIBS).toFixed(2)),
                icmsResidual: parseFloat(Decimal.from(ibsValor).mul(fatorICMS).toFixed(2))
            },
            total_reforma: parseFloat(Decimal.from(cbsValor).add(ibsValor).add(isValor).toFixed(2))
        };
    }

    static normalizarResultado(calc) {
        const base = calc.base || 0;
        return {
            cbs: {
                cClassTrib: calc.cbs?.cClassTrib || null,
                baseCalculo: calc.cbs?.valor > 0 ? base : 0,
                aliquota: calc.cbs?.aliquota || 0,
                valor: calc.cbs?.valor || 0,
                regra_id: calc.cbs?.regra_id || null
            },
            ibs: {
                cClassTrib: calc.ibs?.cClassTrib || null,
                baseCalculo: calc.ibs?.valor > 0 ? base : 0,
                aliquota: calc.ibs?.aliquota || 0,
                valor: calc.ibs?.valor || 0,
                regra_id: calc.ibs?.regra_id || null
            },
            imposto_seletivo: {
                cClassTrib: calc.imposto_seletivo?.cClassTrib || null,
                baseCalculo: calc.imposto_seletivo?.valor > 0 ? base : 0,
                aliquota: calc.imposto_seletivo?.aliquota || 0,
                valor: calc.imposto_seletivo?.valor || 0,
                regra_id: calc.imposto_seletivo?.regra_id || null
            },
            transicao: calc.transicao ? {
                ano: calc.transicao.ano,
                percentualIBS: calc.transicao.percentualIBS,
                percentualICMS: calc.transicao.percentualICMS,
                ibsEfetivo: calc.transicao.ibsEfetivo || 0,
                icmsResidual: calc.transicao.icmsResidual || calc.transicao.icmsIssResidual || 0
            } : null,
            total_reforma: calc.total_reforma || 0
        };
    }

    static adicionarXMLIBSCBS(impostoNode, ibsCbsCalc) {
        if (!ibsCbsCalc) return;

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

        if (ibsCbsCalc.ibs && ibsCbsCalc.ibs.cClassTrib) {
            const ibs = impostoNode.ele('IBS');
            ibs.ele('cClassTrib').txt(ibsCbsCalc.ibs.cClassTrib);
            if (ibsCbsCalc.ibs.valor > 0) {
                ibs.ele('vBC').txt(Decimal.from(ibsCbsCalc.ibs.baseCalculo).toFixed(2));
                ibs.ele('pIBS').txt(Decimal.from(ibsCbsCalc.ibs.aliquota).toFixed(4));
                ibs.ele('vIBS').txt(Decimal.from(ibsCbsCalc.ibs.valor).toFixed(2));
            }
            if (ibsCbsCalc.transicao) {
                ibs.ele('pIBSEfetivo').txt(Decimal.from(ibsCbsCalc.transicao.percentualIBS).toFixed(2));
                ibs.ele('vIBSEfetivo').txt(Decimal.from(ibsCbsCalc.transicao.ibsEfetivo).toFixed(2));
                ibs.ele('vICMSResidual').txt(Decimal.from(ibsCbsCalc.transicao.icmsResidual).toFixed(2));
            }
            ibs.up();
        }

        if (ibsCbsCalc.imposto_seletivo && ibsCbsCalc.imposto_seletivo.valor > 0) {
            const isNode = impostoNode.ele('IS');
            if (ibsCbsCalc.imposto_seletivo.cClassTrib) {
                isNode.ele('cClassTrib').txt(ibsCbsCalc.imposto_seletivo.cClassTrib);
            }
            isNode.ele('vBC').txt(Decimal.from(ibsCbsCalc.imposto_seletivo.baseCalculo).toFixed(2));
            isNode.ele('pIS').txt(Decimal.from(ibsCbsCalc.imposto_seletivo.aliquota).toFixed(4));
            isNode.ele('vIS').txt(Decimal.from(ibsCbsCalc.imposto_seletivo.valor).toFixed(2));
            isNode.up();
        }
    }

    static totalizarIBSCBS(itensCalculados) {
        let totalCBS = Decimal.from(0);
        let totalIBS = Decimal.from(0);
        let totalIS = Decimal.from(0);
        let totalIBSEfetivo = Decimal.from(0);
        let totalICMSResidual = Decimal.from(0);

        for (const calc of itensCalculados || []) {
            if (!calc) continue;
            totalCBS = totalCBS.add(calc.cbs?.valor || 0);
            totalIBS = totalIBS.add(calc.ibs?.valor || 0);
            totalIS = totalIS.add(calc.imposto_seletivo?.valor || 0);
            if (calc.transicao) {
                totalIBSEfetivo = totalIBSEfetivo.add(calc.transicao.ibsEfetivo || 0);
                totalICMSResidual = totalICMSResidual.add(calc.transicao.icmsResidual || 0);
            }
        }

        const totalCBSNum = parseFloat(totalCBS.toFixed(2));
        const totalIBSNum = parseFloat(totalIBS.toFixed(2));
        const totalISNum = parseFloat(totalIS.toFixed(2));

        return {
            totalCBS: totalCBSNum,
            totalIBS: totalIBSNum,
            totalIS: totalISNum,
            totalImpostoSeletivo: totalISNum,
            totalReforma: parseFloat(Decimal.from(totalCBSNum).add(totalIBSNum).add(totalISNum).toFixed(2)),
            totalIBSEfetivo: parseFloat(totalIBSEfetivo.toFixed(2)),
            totalICMSResidual: parseFloat(totalICMSResidual.toFixed(2))
        };
    }
}

module.exports = IBSCBSService;
module.exports.ALIQUOTAS_REFERENCIA = ALIQUOTAS_REFERENCIA;
module.exports.CRONOGRAMA_TRANSICAO = CRONOGRAMA_TRANSICAO;
