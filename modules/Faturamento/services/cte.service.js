// =================================================================
// SERVIÇO CT-e - ALUFORCE v2.0
// Geração de XML CT-e v4.00, validação, DACTE
// =================================================================
'use strict';

let xmlbuilder2;
try { xmlbuilder2 = require('xmlbuilder2'); } catch (e) { /* fallback below */ }

class CTeService {

    /**
     * Gera XML do CT-e conforme layout v4.00
     * @param {Object} dados - Dados do CT-e
     * @param {Object} emitente - Dados do emitente (empresa_config)
     * @returns {string} XML assinável
     */
    static gerarXML(dados, emitente) {
        if (!xmlbuilder2) {
            throw new Error('xmlbuilder2 não instalado. Execute: npm install xmlbuilder2');
        }

        const cUF = emitente.codigo_uf || '35';
        const dhEmi = dados.data_emissao instanceof Date
            ? dados.data_emissao.toISOString().replace('Z', '-03:00')
            : new Date().toISOString().replace('Z', '-03:00');
        const tpAmb = dados.ambiente || 2;
        const mod = dados.modelo || '57';
        const serie = dados.serie || 1;
        const nCT = dados.numero_cte || 1;

        // Gerar código numérico e chave de acesso
        const cCT = CTeService._gerarCodigoNumerico();
        const chave = CTeService._gerarChaveAcesso(cUF, dhEmi, emitente.cnpj, mod, serie, nCT, tpAmb, cCT);

        const doc = xmlbuilder2.create({ version: '1.0', encoding: 'UTF-8' });
        const cteProc = doc.ele('cteProc', {
            xmlns: 'http://www.portalfiscal.inf.br/cte',
            versao: '4.00'
        });

        const CTe = cteProc.ele('CTe', { xmlns: 'http://www.portalfiscal.inf.br/cte' });
        const infCte = CTe.ele('infCte', {
            Id: `CTe${chave}`,
            versao: '4.00'
        });

        // ===== IDE =====
        const ide = infCte.ele('ide');
        ide.ele('cUF').txt(cUF);
        ide.ele('cCT').txt(cCT);
        ide.ele('CFOP').txt(dados.cfop || '5353');
        ide.ele('natOp').txt(dados.natureza_operacao || 'PRESTACAO DE SERVICO DE TRANSPORTE');
        ide.ele('mod').txt(mod);
        ide.ele('serie').txt(String(serie));
        ide.ele('nCT').txt(String(nCT));
        ide.ele('dhEmi').txt(dhEmi);
        ide.ele('tpImp').txt('1'); // DACTE normal
        ide.ele('tpEmis').txt('1'); // Emissão normal
        ide.ele('cDV').txt(chave.substring(43)); // dígito verificador
        ide.ele('tpAmb').txt(String(tpAmb));
        ide.ele('tpCTe').txt(CTeService._mapTipoCTe(dados.tipo_cte));
        ide.ele('procEmi').txt('0'); // Aplicativo contribuinte
        ide.ele('verProc').txt('ALUFORCE-2.0');
        ide.ele('cMunEnv').txt(dados.codigo_municipio_inicio || emitente.codigo_municipio || '');
        ide.ele('xMunEnv').txt(dados.municipio_inicio || '');
        ide.ele('UFEnv').txt(dados.uf_inicio || emitente.uf || 'SP');
        ide.ele('modal').txt(CTeService._mapModal(dados.modal));
        ide.ele('tpServ').txt(CTeService._mapTipoServico(dados.tipo_servico));
        ide.ele('cMunIni').txt(dados.codigo_municipio_inicio || '');
        ide.ele('xMunIni').txt(dados.municipio_inicio || '');
        ide.ele('UFIni').txt(dados.uf_inicio || '');
        ide.ele('cMunFim').txt(dados.codigo_municipio_fim || '');
        ide.ele('xMunFim').txt(dados.municipio_fim || '');
        ide.ele('UFFim').txt(dados.uf_fim || '');

        // Indicador do tomador
        const indToma = { 'remetente': '0', 'expedidor': '1', 'recebedor': '2', 'destinatario': '3', 'outros': '4' };
        const toma = ide.ele('toma3');
        toma.ele('toma').txt(indToma[dados.tomador_tipo] || '0');

        // ===== EMITENTE =====
        const emit = infCte.ele('emit');
        emit.ele('CNPJ').txt(emitente.cnpj || '');
        emit.ele('IE').txt(emitente.inscricao_estadual || '');
        emit.ele('xNome').txt(emitente.razao_social || '');
        if (emitente.nome_fantasia) emit.ele('xFant').txt(emitente.nome_fantasia);
        const enderEmit = emit.ele('enderEmit');
        enderEmit.ele('xLgr').txt(emitente.endereco || '');
        enderEmit.ele('nro').txt(emitente.numero_endereco || 'S/N');
        enderEmit.ele('xBairro').txt(emitente.bairro || '');
        enderEmit.ele('cMun').txt(emitente.codigo_municipio || '');
        enderEmit.ele('xMun').txt(emitente.cidade || '');
        enderEmit.ele('CEP').txt(emitente.cep || '');
        enderEmit.ele('UF').txt(emitente.uf || 'SP');

        // ===== REMETENTE =====
        if (dados.rem_cnpj) {
            const rem = infCte.ele('rem');
            rem.ele('CNPJ').txt(dados.rem_cnpj);
            rem.ele('IE').txt(dados.rem_ie || '');
            rem.ele('xNome').txt(dados.rem_razao_social || '');
            const enderReme = rem.ele('enderReme');
            enderReme.ele('xLgr').txt('');
            enderReme.ele('nro').txt('');
            enderReme.ele('xBairro').txt('');
            enderReme.ele('cMun').txt(dados.rem_codigo_municipio || '');
            enderReme.ele('xMun').txt(dados.rem_municipio || '');
            enderReme.ele('UF').txt(dados.rem_uf || '');
        }

        // ===== DESTINATÁRIO =====
        if (dados.dest_cnpj) {
            const dest = infCte.ele('dest');
            dest.ele('CNPJ').txt(dados.dest_cnpj);
            dest.ele('IE').txt(dados.dest_ie || '');
            dest.ele('xNome').txt(dados.dest_razao_social || '');
            const enderDest = dest.ele('enderDest');
            enderDest.ele('xLgr').txt('');
            enderDest.ele('nro').txt('');
            enderDest.ele('xBairro').txt('');
            enderDest.ele('cMun').txt(dados.dest_codigo_municipio || '');
            enderDest.ele('xMun').txt(dados.dest_municipio || '');
            enderDest.ele('UF').txt(dados.dest_uf || '');
        }

        // ===== VALORES =====
        const vPrest = infCte.ele('vPrest');
        vPrest.ele('vTPrest').txt(CTeService._dec(dados.valor_total_servico));
        vPrest.ele('vRec').txt(CTeService._dec(dados.valor_receber || dados.valor_total_servico));

        // Componentes de valor
        const componentes = dados.componentes || [];
        if (componentes.length === 0) {
            // Adicionar componente padrão
            const comp = vPrest.ele('Comp');
            comp.ele('xNome').txt('FRETE VALOR');
            comp.ele('vComp').txt(CTeService._dec(dados.valor_total_servico));
        } else {
            for (const c of componentes) {
                const comp = vPrest.ele('Comp');
                comp.ele('xNome').txt(c.nome || 'FRETE');
                comp.ele('vComp').txt(CTeService._dec(c.valor));
            }
        }

        // ===== IMPOSTOS =====
        const imp = infCte.ele('imp');
        const icms = imp.ele('ICMS');

        const cstICMS = dados.cst_icms || '00';
        if (cstICMS === '00') {
            const icms00 = icms.ele('ICMS00');
            icms00.ele('CST').txt('00');
            icms00.ele('vBC').txt(CTeService._dec(dados.bc_icms || dados.valor_total_servico));
            icms00.ele('pICMS').txt(CTeService._dec(dados.aliquota_icms || 12));
            icms00.ele('vICMS').txt(CTeService._dec(dados.valor_icms || 0));
        } else if (cstICMS === '20') {
            const icms20 = icms.ele('ICMS20');
            icms20.ele('CST').txt('20');
            icms20.ele('pRedBC').txt(CTeService._dec(dados.reducao_bc || 0));
            icms20.ele('vBC').txt(CTeService._dec(dados.bc_icms || 0));
            icms20.ele('pICMS').txt(CTeService._dec(dados.aliquota_icms || 12));
            icms20.ele('vICMS').txt(CTeService._dec(dados.valor_icms || 0));
        } else if (cstICMS === '40' || cstICMS === '41' || cstICMS === '51') {
            const icms45 = icms.ele('ICMS45');
            icms45.ele('CST').txt(cstICMS);
        } else if (cstICMS === '60') {
            const icms60 = icms.ele('ICMS60');
            icms60.ele('CST').txt('60');
            icms60.ele('vBCSTRet').txt(CTeService._dec(dados.bc_icms_st || 0));
            icms60.ele('vICMSSTRet').txt(CTeService._dec(dados.icms_st || 0));
            icms60.ele('pICMSSTRet').txt(CTeService._dec(dados.aliquota_icms || 0));
            icms60.ele('vCred').txt('0.00');
        } else if (cstICMS === '90') {
            const icms90 = icms.ele('ICMS90');
            icms90.ele('CST').txt('90');
            icms90.ele('pRedBC').txt(CTeService._dec(dados.reducao_bc || 0));
            icms90.ele('vBC').txt(CTeService._dec(dados.bc_icms || 0));
            icms90.ele('pICMS').txt(CTeService._dec(dados.aliquota_icms || 0));
            icms90.ele('vICMS').txt(CTeService._dec(dados.valor_icms || 0));
            icms90.ele('vCred').txt('0.00');
        } else {
            // SN - Simples Nacional
            const icmsSN = icms.ele('ICMSOutraUF');
            icmsSN.ele('CST').txt('90');
            icmsSN.ele('pRedBCOutraUF').txt('0.00');
            icmsSN.ele('vBCOutraUF').txt('0.00');
            icmsSN.ele('pICMSOutraUF').txt('0.00');
            icmsSN.ele('vICMSOutraUF').txt('0.00');
        }

        // ===== INFORMAÇÕES DA CARGA =====
        const infCTeNorm = infCte.ele('infCTeNorm');
        const infCarga = infCTeNorm.ele('infCarga');
        infCarga.ele('vCarga').txt(CTeService._dec(dados.valor_carga || 0));
        infCarga.ele('proPred').txt(dados.produto_predominante || 'CONDUTORES ELETRICOS');
        // Peso bruto
        const cargaKG = infCarga.ele('infQ');
        cargaKG.ele('cUnid').txt('01'); // KG
        cargaKG.ele('tpMed').txt('PESO BRUTO');
        cargaKG.ele('qCarga').txt(CTeService._dec4(dados.carga_peso_bruto || 0));

        if (dados.carga_volume > 0) {
            const cargaVol = infCarga.ele('infQ');
            cargaVol.ele('cUnid').txt('03'); // UNIDADE
            cargaVol.ele('tpMed').txt('VOLUMES');
            cargaVol.ele('qCarga').txt(CTeService._dec4(dados.carga_volume || 0));
        }

        // ===== MODAL RODOVIÁRIO =====
        if (dados.modal === 'rodoviario' || !dados.modal) {
            const infModal = infCTeNorm.ele('infModal', { versaoModal: '4.00' });
            const rodo = infModal.ele('rodo');
            rodo.ele('RNTRC').txt(dados.rntrc || emitente.rntrc || '');

            // Veículo
            if (dados.placa_veiculo) {
                const veic = rodo.ele('veic');
                veic.ele('cInt').txt(dados.placa_veiculo);
                veic.ele('RENAVAM').txt(dados.renavam || '');
                veic.ele('placa').txt(dados.placa_veiculo);
                veic.ele('tara').txt(String(dados.tara_veiculo || 0));
                veic.ele('capKG').txt(String(dados.capacidade_kg || 0));
                veic.ele('UF').txt(dados.uf_veiculo || emitente.uf || 'SP');
                veic.ele('tpProp').txt('P'); // P=Próprio
            }

            // Motorista
            if (dados.motorista_cpf) {
                const moto = rodo.ele('moto');
                moto.ele('xNome').txt(dados.motorista_nome || '');
                moto.ele('CPF').txt(dados.motorista_cpf);
            }
        }

        // ===== DOCUMENTOS VINCULADOS =====
        if (dados.documentos && dados.documentos.length > 0) {
            const infDoc = infCTeNorm.ele('infDoc');
            for (const doc of dados.documentos) {
                if (doc.tipo_documento === 'nfe' && doc.chave_nfe) {
                    const infNFe = infDoc.ele('infNFe');
                    infNFe.ele('chave').txt(doc.chave_nfe);
                }
            }
        }

        // Gerar string XML
        const xmlString = doc.end({ prettyPrint: true });

        return {
            xml: xmlString,
            chave: chave,
            numero: nCT,
            serie: serie
        };
    }

    /**
     * Valida dados mínimos para emissão de CT-e
     */
    static validar(dados) {
        const erros = [];

        if (!dados.cfop) erros.push('CFOP é obrigatório');
        if (!dados.rem_cnpj && !dados.rem_cpf) erros.push('CNPJ/CPF do remetente é obrigatório');
        if (!dados.dest_cnpj && !dados.dest_cpf) erros.push('CNPJ/CPF do destinatário é obrigatório');
        if (!dados.valor_total_servico || dados.valor_total_servico <= 0) erros.push('Valor do serviço deve ser > 0');
        if (!dados.municipio_inicio) erros.push('Município de início é obrigatório');
        if (!dados.municipio_fim) erros.push('Município de fim é obrigatório');
        if (!dados.uf_inicio) erros.push('UF de início é obrigatória');
        if (!dados.uf_fim) erros.push('UF de fim é obrigatória');

        return { valido: erros.length === 0, erros };
    }

    /**
     * Calcula ICMS do CT-e
     */
    static calcularICMS(dados, regimeEmitente) {
        const valorServico = parseFloat(dados.valor_total_servico) || 0;
        let aliquota = parseFloat(dados.aliquota_icms) || 0;
        let cst = dados.cst_icms || '00';
        let bc = valorServico;
        let reducao = parseFloat(dados.reducao_bc) || 0;

        // Se regime simples, CST 90 normalmente
        if (regimeEmitente === 'simples') {
            cst = '90';
            aliquota = 0;
            bc = 0;
        }

        // Aplicar redução
        if (reducao > 0) {
            bc = bc * (1 - reducao / 100);
            cst = '20';
        }

        const valorICMS = bc * aliquota / 100;

        return {
            cst_icms: cst,
            bc_icms: Math.round(bc * 100) / 100,
            aliquota_icms: aliquota,
            valor_icms: Math.round(valorICMS * 100) / 100,
            reducao_bc: reducao
        };
    }

    // ==================== HELPERS ====================

    static _gerarCodigoNumerico() {
        return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
    }

    static _gerarChaveAcesso(cUF, dhEmi, cnpj, mod, serie, nCT, tpAmb, cCT) {
        const dt = new Date(dhEmi);
        const AAMM = String(dt.getFullYear()).substring(2) + String(dt.getMonth() + 1).padStart(2, '0');

        let chave = cUF + AAMM + cnpj.replace(/\D/g, '').padStart(14, '0') +
                    mod + String(serie).padStart(3, '0') +
                    String(nCT).padStart(9, '0') +
                    String(tpAmb) + cCT;

        // Dígito verificador (mod 11)
        const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
        let soma = 0;
        for (let i = chave.length - 1, p = 0; i >= 0; i--, p++) {
            soma += parseInt(chave[i]) * pesos[p % 8];
        }
        const resto = soma % 11;
        const dv = resto < 2 ? 0 : 11 - resto;

        return chave + String(dv);
    }

    static _dec(valor) {
        return (parseFloat(valor) || 0).toFixed(2);
    }

    static _dec4(valor) {
        return (parseFloat(valor) || 0).toFixed(4);
    }

    static _mapTipoCTe(tipo) {
        const map = { 'normal': '0', 'complementar': '1', 'anulacao': '2', 'substituto': '3' };
        return map[tipo] || '0';
    }

    static _mapModal(modal) {
        const map = { 'rodoviario': '01', 'aereo': '02', 'aquaviario': '03', 'ferroviario': '04', 'dutoviario': '05', 'multimodal': '06' };
        return map[modal] || '01';
    }

    static _mapTipoServico(tipo) {
        const map = { 'normal': '0', 'subcontratacao': '1', 'redespacho': '2', 'redespacho_intermediario': '3', 'multimodal': '4' };
        return map[tipo] || '0';
    }
}

module.exports = CTeService;
