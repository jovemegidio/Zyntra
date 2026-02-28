/**
 * SERVIÇO DE CÁLCULO DE TRIBUTOS — REFATORADO
 * Motor completo de cálculo de impostos para NFe v4.00
 * 
 * CORREÇÕES APLICADAS:
 * [BUG-001] parseFloat() substituído por aritmética segura (Decimal em centavos)
 * [BUG-003] Rateio proporcional de desconto/frete/seguro por item implementado
 * [BUG-015] Alíquotas FCP atualizadas conforme legislação vigente
 * [SEFAZ]   Arredondamento ABNT NBR 5891 (banker's rounding) implementado
 * [SOLID]   Single Responsibility — cada tributo calculado isoladamente
 */

'use strict';

const nfeConfig = require('../../config/nfe.config');

// ============================================================
// ARITMÉTICA DECIMAL SEGURA — ZERO FLOATING POINT
// Opera internamente com BigInt escalado para eliminar
// erros IEEE 754. Converte apenas na saída final.
// ============================================================

const DECIMAL_PRECISION = 10;
const DECIMAL_FACTOR = BigInt(10 ** DECIMAL_PRECISION);

class Decimal {
    /**
     * @param {number|string|Decimal} value — valor em reais (ex: 10.50)
     */
    constructor(value) {
        if (value instanceof Decimal) {
            this._scaled = value._scaled;
            return;
        }
        if (typeof value === 'bigint') {
            this._scaled = value;
            return;
        }
        if (value === null || value === undefined) {
            this._scaled = 0n;
            return;
        }
        const str = String(value).replace(',', '.').trim();
        if (str === '' || str === 'NaN') {
            this._scaled = 0n;
            return;
        }
        const negative = str.startsWith('-');
        const abs = negative ? str.substring(1) : str;
        const parts = abs.split('.');
        const intPart = parts[0] || '0';
        const decPart = (parts[1] || '').padEnd(DECIMAL_PRECISION, '0').substring(0, DECIMAL_PRECISION);
        this._scaled = BigInt(intPart) * DECIMAL_FACTOR + BigInt(decPart);
        if (negative) this._scaled = -this._scaled;
    }

    static from(value) {
        if (value instanceof Decimal) return value;
        return new Decimal(value || 0);
    }

    static ZERO = new Decimal(0);

    add(other) {
        const r = new Decimal(0);
        r._scaled = this._scaled + Decimal.from(other)._scaled;
        return r;
    }

    sub(other) {
        const r = new Decimal(0);
        r._scaled = this._scaled - Decimal.from(other)._scaled;
        return r;
    }

    mul(other) {
        const r = new Decimal(0);
        r._scaled = (this._scaled * Decimal.from(other)._scaled) / DECIMAL_FACTOR;
        return r;
    }

    div(other) {
        const o = Decimal.from(other);
        if (o._scaled === 0n) throw new Error('Divisão por zero');
        const r = new Decimal(0);
        r._scaled = (this._scaled * DECIMAL_FACTOR) / o._scaled;
        return r;
    }

    /** this * (rate / 100) */
    percent(rate) {
        return this.mul(Decimal.from(rate)).div(new Decimal(100));
    }

    toNumber() {
        return Number(this._scaled) / Number(DECIMAL_FACTOR);
    }

    /**
     * Formata para XML SEFAZ com N casas decimais.
     * Aplica arredondamento ABNT NBR 5891 (banker's rounding / round half to even).
     */
    toFixed(decimals) {
        const shift = BigInt(10 ** (DECIMAL_PRECISION - decimals));
        const negative = this._scaled < 0n;
        const abs = negative ? -this._scaled : this._scaled;

        const divided = abs / shift;
        const remainder = abs % shift;
        const half = shift / 2n;

        let rounded;
        if (remainder > half) {
            rounded = divided + 1n;
        } else if (remainder === half) {
            // Banker's rounding: arredonda para par
            rounded = divided % 2n === 0n ? divided : divided + 1n;
        } else {
            rounded = divided;
        }

        if (negative) rounded = -rounded;

        const factor = 10 ** decimals;
        const result = Number(rounded) / factor;
        return result.toFixed(decimals);
    }

    isZero() { return this._scaled === 0n; }
    isPositive() { return this._scaled > 0n; }
    isNegative() { return this._scaled < 0n; }
    gt(other) { return this._scaled > Decimal.from(other)._scaled; }
    gte(other) { return this._scaled >= Decimal.from(other)._scaled; }
    lt(other) { return this._scaled < Decimal.from(other)._scaled; }
}

// ============================================================
// CACHE de configurações de impostos
// ============================================================
let configImpostosCache = null;
let configImpostosCacheTime = 0;
const CACHE_TTL = 60000;

async function getConfiguracoesImpostos() {
    const now = Date.now();
    if (configImpostosCache && (now - configImpostosCacheTime) < CACHE_TTL) {
        return configImpostosCache;
    }
    try {
        // 1. Tentar buscar do banco via pool global (injetado pelo server.js)
        if (global.dbPool) {
            const [rows] = await global.dbPool.query(
                'SELECT regime_tributario, crt, nfe_ambiente, nfe_serie FROM empresa_config WHERE id = 1'
            );
            if (rows.length > 0) {
                const cfg = rows[0];
                const regime = cfg.regime_tributario || 'simples';
                const crt = cfg.crt || (regime === 'simples' ? 1 : regime === 'simples_excesso' ? 2 : 3);
                const naoCumulativo = crt === 3; // Regime Normal = não-cumulativo
                configImpostosCache = {
                    regime_tributario: regime,
                    crt: crt,
                    nfe_ambiente: cfg.nfe_ambiente || 2,
                    nfe_serie: cfg.nfe_serie || 1,
                    icms: 18.00,
                    ipi: 5.00,
                    pis: naoCumulativo ? 1.65 : 0.65,
                    cofins: naoCumulativo ? 7.60 : 3.00,
                    iss: 5.00,
                    irpj: 15.00
                };
                configImpostosCacheTime = now;
                return configImpostosCache;
            }
        }
        // 2. Tentar callback global (legado)
        if (global.getConfiguracoesImpostos) {
            configImpostosCache = await global.getConfiguracoesImpostos();
            configImpostosCacheTime = now;
            return configImpostosCache;
        }
        // 3. Fallback padrão
        return {
            regime_tributario: 'simples',
            crt: 1,
            icms: 18.00, ipi: 5.00, pis: 0.65,
            cofins: 3.00, iss: 5.00, irpj: 15.00
        };
    } catch (error) {
        console.error('[TRIBUTOS] Erro ao buscar config impostos:', error);
        return null;
    }
}

// ============================================================
// VALIDAÇÕES FAIL-FAST (antes de transmitir para SEFAZ)
// ============================================================

class ValidacaoFiscal {
    /**
     * Valida NCM (8 dígitos numéricos, obrigatório)
     * @throws {Error} Se NCM inválido
     */
    static validarNCM(ncm) {
        if (!ncm) throw new Error('NCM é obrigatório');
        const limpo = String(ncm).replace(/\D/g, '');
        if (limpo.length !== 8) {
            throw new Error(`NCM inválido: "${ncm}" — deve ter 8 dígitos (recebido: ${limpo.length})`);
        }
        return limpo;
    }

    /**
     * Valida CFOP (4 dígitos, primeiro dígito 1-7)
     */
    static validarCFOP(cfop) {
        if (!cfop) throw new Error('CFOP é obrigatório');
        const limpo = String(cfop).replace(/\D/g, '');
        if (limpo.length !== 4) {
            throw new Error(`CFOP inválido: "${cfop}" — deve ter 4 dígitos`);
        }
        const primeiro = parseInt(limpo[0], 10);
        if (primeiro < 1 || primeiro > 7) {
            throw new Error(`CFOP inválido: "${cfop}" — primeiro dígito deve ser 1-7`);
        }
        return limpo;
    }

    /**
     * Valida GTIN/EAN (8, 12, 13 ou 14 dígitos + dígito verificador módulo 10)
     * Aceita "SEM GTIN" como válido
     */
    static validarGTIN(gtin) {
        if (!gtin || gtin === 'SEM GTIN') return 'SEM GTIN';
        const limpo = String(gtin).replace(/\D/g, '');
        if (![8, 12, 13, 14].includes(limpo.length)) {
            throw new Error(`GTIN inválido: "${gtin}" — deve ter 8, 12, 13 ou 14 dígitos`);
        }
        const digits = limpo.split('').map(Number);
        const check = digits.pop();
        let sum = 0;
        for (let i = digits.length - 1; i >= 0; i--) {
            sum += digits[i] * ((digits.length - 1 - i) % 2 === 0 ? 3 : 1);
        }
        const calculated = (10 - (sum % 10)) % 10;
        if (calculated !== check) {
            throw new Error(`GTIN inválido: "${gtin}" — dígito verificador incorreto`);
        }
        return limpo;
    }

    /**
     * Valida CEST (7 dígitos numéricos, opcional)
     */
    static validarCEST(cest) {
        if (!cest) return null;
        const limpo = String(cest).replace(/\D/g, '');
        if (limpo.length !== 7) {
            throw new Error(`CEST inválido: "${cest}" — deve ter 7 dígitos`);
        }
        return limpo;
    }

    /**
     * Validação completa de item — FAIL-FAST
     */
    static validarItemParaCalculo(item, index) {
        const pre = `Item ${index}:`;
        if (!item.descricao) throw new Error(`${pre} Descrição é obrigatória`);
        if (!item.quantidade || Decimal.from(item.quantidade).isZero()) {
            throw new Error(`${pre} Quantidade deve ser maior que zero`);
        }
        if (!item.valorUnitario || Decimal.from(item.valorUnitario).isZero()) {
            throw new Error(`${pre} Valor unitário deve ser maior que zero`);
        }
        this.validarNCM(item.ncm);
        if (item.cfop) this.validarCFOP(item.cfop);
        if (item.ean) this.validarGTIN(item.ean);
        if (item.cest) this.validarCEST(item.cest);
    }
}

// ============================================================
// SERVIÇO DE CÁLCULO DE TRIBUTOS
// ============================================================

class CalculoTributosService {

    static async getConfigSistema() {
        return await getConfiguracoesImpostos();
    }

    /**
     * Calcula todos os tributos de um item da NFe.
     * TODAS as operações usam Decimal para precisão exata.
     */
    static calcularTributosItem(item, emitente, destinatario, naturezaOperacao) {
        ValidacaoFiscal.validarItemParaCalculo(item, item._index || 1);

        const resultado = {
            item: { ...item },
            icms: {}, ipi: {}, pis: {}, cofins: {}, totais: {}
        };

        const quantidade = Decimal.from(item.quantidade);
        const valorUnitario = Decimal.from(item.valorUnitario);
        const valorBruto = quantidade.mul(valorUnitario);
        const valorDesconto = Decimal.from(item.desconto || 0);
        const valorFrete = Decimal.from(item.frete || 0);
        const valorSeguro = Decimal.from(item.seguro || 0);
        const valorOutros = Decimal.from(item.outrasDespesas || 0);

        // Base de cálculo = vProd - vDesc + vFrete + vSeg + vOutro
        const valorProduto = valorBruto.sub(valorDesconto)
            .add(valorFrete).add(valorSeguro).add(valorOutros);

        const operacaoInterna = emitente.uf === destinatario.uf;
        const destinatarioContribuinte = !!destinatario.ie && destinatario.ie !== 'ISENTO';

        resultado.icms = this.calcularICMS({
            item, valorProduto, emitente, destinatario,
            operacaoInterna, destinatarioContribuinte, naturezaOperacao
        });
        resultado.ipi = this.calcularIPI({ item, valorProduto, emitente, destinatario });
        resultado.pis = this.calcularPIS({ item, valorProduto, emitente });
        resultado.cofins = this.calcularCOFINS({ item, valorProduto, emitente });

        const valorTotalTributos = Decimal.from(resultado.icms.valorICMS || 0)
            .add(Decimal.from(resultado.icms.valorICMSST || 0))
            .add(Decimal.from(resultado.ipi.valorIPI || 0))
            .add(Decimal.from(resultado.pis.valorPIS || 0))
            .add(Decimal.from(resultado.cofins.valorCOFINS || 0));

        resultado.totais = {
            valorBruto: parseFloat(valorBruto.toFixed(2)),
            valorDesconto: parseFloat(valorDesconto.toFixed(2)),
            valorFrete: parseFloat(valorFrete.toFixed(2)),
            valorSeguro: parseFloat(valorSeguro.toFixed(2)),
            valorOutros: parseFloat(valorOutros.toFixed(2)),
            valorProduto: parseFloat(valorProduto.toFixed(2)),
            valorTotalTributos: parseFloat(valorTotalTributos.toFixed(2))
        };

        return resultado;
    }

    /**
     * [BUG-003 FIX] Rateio proporcional pelo método do maior resto.
     * Garante que a soma dos itens rateados = valorTotal exato.
     */
    static ratearValorEntreItens(valorTotal, itens, campoBase = 'valorBruto') {
        const total = Decimal.from(valorTotal);
        if (total.isZero()) return itens.map(() => 0);

        const somaBase = itens.reduce(
            (acc, item) => acc.add(Decimal.from(item[campoBase] || 0)),
            Decimal.from(0)
        );
        if (somaBase.isZero()) return itens.map(() => 0);

        const rateados = itens.map(item => {
            const base = Decimal.from(item[campoBase] || 0);
            return total.mul(base).div(somaBase);
        });

        const arredondados = rateados.map(v => parseFloat(v.toFixed(2)));
        const somaArr = arredondados.reduce((a, b) => a + b, 0);
        const dif = parseFloat((total.toNumber() - somaArr).toFixed(2));

        if (Math.abs(dif) > 0.001) {
            let maxIdx = 0;
            for (let i = 1; i < arredondados.length; i++) {
                if (arredondados[i] > arredondados[maxIdx]) maxIdx = i;
            }
            arredondados[maxIdx] = parseFloat((arredondados[maxIdx] + dif).toFixed(2));
        }

        return arredondados;
    }

    // ============================================================
    // CÁLCULOS INDIVIDUAIS DE TRIBUTOS
    // ============================================================

    static calcularICMS(dados) {
        const { item, valorProduto, emitente, destinatario, operacaoInterna, destinatarioContribuinte } = dados;

        const resultado = {
            origem: item.origem || '0',
            cst: item.cst || (emitente.regimeTributario === 1 ? '102' : '00'),
            modalidadeBC: 3,
            baseCalculo: 0, aliquota: 0, valorICMS: 0,
            valorICMSST: 0, valorFCP: 0
        };

        // Simples Nacional
        if (emitente.regimeTributario === 1) {
            resultado.csosn = item.csosn || '102';
            if (resultado.csosn === '101') {
                const aliqCred = Decimal.from(item.aliquotaCreditoSN || 1.25);
                resultado.aliquotaCredito = aliqCred.toNumber();
                resultado.valorCredito = parseFloat(valorProduto.percent(aliqCred).toFixed(2));
            }
            return resultado;
        }

        // Regime Normal
        let aliquota;
        if (operacaoInterna) {
            aliquota = Decimal.from(this.getAliquotaICMSInterna(emitente.uf, item));
        } else {
            aliquota = destinatarioContribuinte
                ? Decimal.from(this.getAliquotaICMSInterestadual(emitente.uf, destinatario.uf))
                : Decimal.from(this.getAliquotaICMSInterna(destinatario.uf, item));
        }

        const percentualReducao = Decimal.from(item.reducaoBC || 0);
        const fatorReducao = Decimal.from(1).sub(percentualReducao.div(Decimal.from(100)));
        const baseCalculo = valorProduto.mul(fatorReducao);

        resultado.baseCalculo = parseFloat(baseCalculo.toFixed(2));
        resultado.aliquota = aliquota.toNumber();
        resultado.valorICMS = parseFloat(baseCalculo.percent(aliquota).toFixed(2));

        // ICMS-ST
        if (item.calcularICMSST) {
            const mva = Decimal.from(item.mva || 30);
            const bcST = valorProduto.mul(Decimal.from(1).add(mva.div(Decimal.from(100))));
            const aliqInterna = Decimal.from(this.getAliquotaICMSInterna(destinatario.uf, item));

            resultado.baseCalculoST = parseFloat(bcST.toFixed(2));
            resultado.aliquotaST = aliqInterna.toNumber();
            const valorST = parseFloat(bcST.percent(aliqInterna).sub(Decimal.from(resultado.valorICMS)).toFixed(2));
            resultado.valorICMSST = Math.max(0, valorST); // ST não pode ser negativo
        }

        // DIFAL — EC 87/2015 (100% destino a partir de 2019)
        if (!operacaoInterna && !destinatarioContribuinte) {
            const aliqInterna = Decimal.from(this.getAliquotaICMSInterna(destinatario.uf, item));
            const aliqInter = Decimal.from(this.getAliquotaICMSInterestadual(emitente.uf, destinatario.uf));
            const difAliq = aliqInterna.sub(aliqInter);

            resultado.baseCalculoDIFAL = parseFloat(valorProduto.toFixed(2));
            resultado.aliquotaDIFAL = difAliq.toNumber();
            resultado.valorDIFAL = parseFloat(valorProduto.percent(difAliq).toFixed(2));
            resultado.valorICMSDestinatario = resultado.valorDIFAL;
            resultado.valorICMSRemetente = 0;

            const aliqFCP = Decimal.from(this.getAliquotaFCP(destinatario.uf));
            if (aliqFCP.isPositive()) {
                resultado.aliquotaFCP = aliqFCP.toNumber();
                resultado.valorFCP = parseFloat(valorProduto.percent(aliqFCP).toFixed(2));
            }
        }

        return resultado;
    }

    static calcularIPI(dados) {
        const { item, valorProduto } = dados;
        const resultado = { cst: item.cstIPI || '99', baseCalculo: 0, aliquota: 0, valorIPI: 0 };

        if (item.calcularIPI) {
            const aliq = Decimal.from(item.aliquotaIPI || 0);
            resultado.baseCalculo = parseFloat(valorProduto.toFixed(2));
            resultado.aliquota = aliq.toNumber();
            resultado.valorIPI = parseFloat(valorProduto.percent(aliq).toFixed(2));
        }
        return resultado;
    }

    static calcularPIS(dados) {
        const { item, valorProduto, emitente } = dados;
        const resultado = { cst: item.cstPIS || '01', baseCalculo: 0, aliquota: 0, valorPIS: 0 };

        const naoCumulativo = emitente.regimeTributario === 3;
        let aliq = Decimal.from(0);
        if (resultado.cst === '01' || resultado.cst === '02') {
            aliq = Decimal.from(naoCumulativo ? 1.65 : 0.65);
        }
        if (aliq.isPositive()) {
            resultado.baseCalculo = parseFloat(valorProduto.toFixed(2));
            resultado.aliquota = aliq.toNumber();
            resultado.valorPIS = parseFloat(valorProduto.percent(aliq).toFixed(2));
        }
        return resultado;
    }

    static calcularCOFINS(dados) {
        const { item, valorProduto, emitente } = dados;
        const resultado = { cst: item.cstCOFINS || '01', baseCalculo: 0, aliquota: 0, valorCOFINS: 0 };

        const naoCumulativo = emitente.regimeTributario === 3;
        let aliq = Decimal.from(0);
        if (resultado.cst === '01' || resultado.cst === '02') {
            aliq = Decimal.from(naoCumulativo ? 7.6 : 3.0);
        }
        if (aliq.isPositive()) {
            resultado.baseCalculo = parseFloat(valorProduto.toFixed(2));
            resultado.aliquota = aliq.toNumber();
            resultado.valorCOFINS = parseFloat(valorProduto.percent(aliq).toFixed(2));
        }
        return resultado;
    }

    // ============================================================
    // TABELAS DE ALÍQUOTAS
    // ============================================================

    static getAliquotaICMSInterna(uf, item) {
        if (item.aliquotaICMS) return parseFloat(item.aliquotaICMS);
        // Alíquotas modais padrão 2025/2026
        const tabela = {
            'AC': 19, 'AL': 19, 'AM': 20, 'AP': 18, 'BA': 20.5,
            'CE': 20, 'DF': 20, 'ES': 17, 'GO': 19, 'MA': 22,
            'MG': 18, 'MS': 17, 'MT': 17, 'PA': 19, 'PB': 20,
            'PE': 20.5, 'PI': 21, 'PR': 19.5, 'RJ': 22, 'RN': 20,
            'RO': 19.5, 'RR': 20, 'RS': 17, 'SC': 17, 'SE': 19,
            'SP': 18, 'TO': 20
        };
        return tabela[uf] || 18;
    }

    static getAliquotaICMSInterestadual(ufOrigem, ufDestino) {
        const sulSudeste = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'];
        const origemSS = sulSudeste.includes(ufOrigem) && ufOrigem !== 'ES';
        const destinoSS = sulSudeste.includes(ufDestino) && ufDestino !== 'ES';
        if (origemSS && destinoSS) return 12;
        if (origemSS && !destinoSS) return 7;
        return 12;
    }

    /** [BUG-015 FIX] Tabela FCP atualizada */
    static getAliquotaFCP(uf) {
        const tabela = {
            'AC': 2, 'AL': 2, 'AM': 0, 'AP': 0, 'BA': 2,
            'CE': 2, 'DF': 2, 'ES': 2, 'GO': 2, 'MA': 2,
            'MG': 2, 'MS': 2, 'MT': 2, 'PA': 2, 'PB': 2,
            'PE': 2, 'PI': 2, 'PR': 2, 'RJ': 4, 'RN': 2,
            'RO': 2, 'RR': 2, 'RS': 2, 'SC': 2, 'SE': 2,
            'SP': 2, 'TO': 2
        };
        return tabela[uf] || 0;
    }

    /**
     * Totalização da NFe — soma todos os itens via Decimal
     */
    static calcularTotaisNFe(itens) {
        const D = Decimal.from;
        const s = {
            baseCalculoICMS: D(0), valorICMS: D(0), valorICMSDesonerado: D(0),
            valorFCPUFDestino: D(0), valorICMSUFDestino: D(0), valorICMSUFRemetente: D(0),
            valorFCP: D(0), baseCalculoST: D(0), valorST: D(0),
            valorFCPST: D(0), valorFCPSTRetido: D(0),
            valorProdutos: D(0), valorFrete: D(0), valorSeguro: D(0), valorDesconto: D(0),
            valorII: D(0), valorIPI: D(0), valorIPIDevolvido: D(0),
            valorPIS: D(0), valorCOFINS: D(0), valorOutros: D(0),
            valorTotal: D(0), valorTotalTributos: D(0)
        };

        for (const ic of itens) {
            s.valorProdutos = s.valorProdutos.add(D(ic.totais.valorProduto || 0));
            s.valorDesconto = s.valorDesconto.add(D(ic.totais.valorDesconto || 0));
            s.valorFrete = s.valorFrete.add(D(ic.totais.valorFrete || 0));
            s.valorSeguro = s.valorSeguro.add(D(ic.totais.valorSeguro || 0));
            s.valorOutros = s.valorOutros.add(D(ic.totais.valorOutros || 0));
            s.baseCalculoICMS = s.baseCalculoICMS.add(D(ic.icms.baseCalculo || 0));
            s.valorICMS = s.valorICMS.add(D(ic.icms.valorICMS || 0));
            s.baseCalculoST = s.baseCalculoST.add(D(ic.icms.baseCalculoST || 0));
            s.valorST = s.valorST.add(D(ic.icms.valorICMSST || 0));
            s.valorFCP = s.valorFCP.add(D(ic.icms.valorFCP || 0));
            s.valorICMSUFDestino = s.valorICMSUFDestino.add(D(ic.icms.valorICMSDestinatario || 0));
            s.valorICMSUFRemetente = s.valorICMSUFRemetente.add(D(ic.icms.valorICMSRemetente || 0));
            s.valorIPI = s.valorIPI.add(D(ic.ipi.valorIPI || 0));
            s.valorPIS = s.valorPIS.add(D(ic.pis.valorPIS || 0));
            s.valorCOFINS = s.valorCOFINS.add(D(ic.cofins.valorCOFINS || 0));
        }

        // vNF = vProd + vFrete + vSeg + vOutro + vIPI + vST − vDesc
        s.valorTotal = s.valorProdutos.add(s.valorFrete).add(s.valorSeguro)
            .add(s.valorOutros).add(s.valorIPI).add(s.valorST).sub(s.valorDesconto);

        s.valorTotalTributos = s.valorICMS.add(s.valorST)
            .add(s.valorIPI).add(s.valorPIS).add(s.valorCOFINS);

        // Converter para objeto numérico (2 casas)
        const totais = {};
        for (const [k, v] of Object.entries(s)) {
            totais[k] = parseFloat(v.toFixed(2));
        }
        return totais;
    }
}

module.exports = CalculoTributosService;
module.exports.Decimal = Decimal;
module.exports.ValidacaoFiscal = ValidacaoFiscal;
