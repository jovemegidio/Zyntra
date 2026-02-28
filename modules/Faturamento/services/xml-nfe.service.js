/**
 * SERVIÇO DE GERAÇÃO DE XML NFe 4.00 — REFATORADO
 * Gera XML conforme layout SEFAZ 4.00 + Manual do Contribuinte
 *
 * CORREÇÕES APLICADAS:
 * [BUG-002] formatarDecimal agora usa Decimal seguro (sem IEEE 754 drift)
 * [BUG-012] Validação fail-fast de NCM/CFOP/GTIN antes de gerar XML
 * [BUG-017] Removido <nfeProc> wrapper — XML de envio NÃO usa nfeProc
 * [XSD]     Hierarquia de tags segue estritamente o XSD v4.00
 * [XSD]     indPag removido do detPag (deprecated desde NT 2016.002)
 * [SEC]     gerarCodigoNumerico usa crypto.randomInt (CSPRNG)
 */

'use strict';

const builder = require('xmlbuilder2');
const crypto = require('crypto');
const { Decimal, ValidacaoFiscal } = require('./calculo-tributos.service');

// Reforma Tributária — NT 2025.002
let IBSCBSService;
try {
    IBSCBSService = require('./ibs-cbs.service');
} catch (e) {
    console.warn('[XML-NFe] IBSCBSService não disponível:', e.message);
}

class XmlNFeService {

    /**
     * Gerar XML completo da NFe (sem <nfeProc>, sem assinatura)
     * A assinatura é adicionada pelo certificado.service antes do envio.
     * [BUG-017 FIX] nfeProc é retorno da SEFAZ, NÃO deve estar no XML de envio.
     */
    static gerarXML(dadosNFe) {
        const { emitente, destinatario, itens, totais, transporte, pagamento, informacoesAdicionais } = dadosNFe;

        // Validar dados mínimos antes de gerar
        if (!emitente || !emitente.cnpj) throw new Error('Emitente com CNPJ é obrigatório');
        if (!destinatario) throw new Error('Destinatário é obrigatório');
        if (!itens || itens.length === 0) throw new Error('Pelo menos um item é obrigatório');
        if (!pagamento || pagamento.length === 0) throw new Error('Forma de pagamento é obrigatória');

        const chaveAcesso = this.gerarChaveAcesso(dadosNFe);
        const idNFe = `NFe${chaveAcesso}`;

        // [BUG-017 FIX] Estrutura: <NFe><infNFe>...</infNFe></NFe>
        // SEM <nfeProc> — esse wrapper só existe no retorno SEFAZ
        const xml = builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('NFe', { xmlns: 'http://www.portalfiscal.inf.br/nfe' })
            .ele('infNFe', { versao: '4.00', Id: idNFe });

        this.adicionarIDE(xml, dadosNFe, chaveAcesso);
        this.adicionarEmitente(xml, emitente);
        this.adicionarDestinatario(xml, destinatario);

        // [BUG-012] Fail-fast: validar cada item antes de serializar
        itens.forEach((item, index) => {
            ValidacaoFiscal.validarItemParaCalculo(item.item || item, index + 1);
            this.adicionarItem(xml, item, index + 1, emitente, destinatario);
        });

        this.adicionarTotal(xml, totais);
        this.adicionarTransporte(xml, transporte);
        this.adicionarPagamento(xml, pagamento);

        if (informacoesAdicionais) {
            this.adicionarInformacoesAdicionais(xml, informacoesAdicionais);
        }

        // Fechar infNFe — assinatura será inserida AQUI pelo certificado.service
        // Posição correta: entre </infNFe> e </NFe>

        const xmlString = xml.end({ prettyPrint: false }); // prettyPrint=false para C14N

        return { xml: xmlString, chaveAcesso, idNFe };
    }

    // ============================================================
    // IDE — Identificação da NFe
    // ============================================================

    static adicionarIDE(xml, dados, chaveAcesso) {
        const ide = xml.ele('ide');

        ide.ele('cUF').txt(dados.codigoUF);
        ide.ele('cNF').txt(String(dados.codigoNumerico || this.gerarCodigoNumerico()).padStart(8, '0'));
        ide.ele('natOp').txt(this.sanitizarTextoXML(dados.naturezaOperacao));
        ide.ele('mod').txt(dados.modelo || '55');
        ide.ele('serie').txt(dados.serie);
        ide.ele('nNF').txt(dados.numeroNFe);
        ide.ele('dhEmi').txt(this.formatarDataHora(dados.dataEmissao || new Date()));
        ide.ele('dhSaiEnt').txt(this.formatarDataHora(dados.dataSaida || new Date()));
        ide.ele('tpNF').txt(dados.tipoOperacao); // 0=Entrada, 1=Saída
        ide.ele('idDest').txt(this.identificarDestinatario(dados.emitente.uf, dados.destinatario.uf));
        ide.ele('cMunFG').txt(dados.emitente.codigoMunicipio);
        ide.ele('tpImp').txt('1'); // DANFE Retrato
        ide.ele('tpEmis').txt(dados.tipoEmissao || '1');
        ide.ele('cDV').txt(String(chaveAcesso).substring(43));
        ide.ele('tpAmb').txt(String(dados.ambiente || '2'));
        ide.ele('finNFe').txt(dados.finalidade || '1');
        ide.ele('indFinal').txt(dados.consumidorFinal || '1');
        ide.ele('indPres').txt(dados.indicadorPresenca || '1');
        ide.ele('procEmi').txt('0');
        ide.ele('verProc').txt(dados.versaoAplicativo || 'ALUFORCE-2.0');

        return ide.up();
    }

    // ============================================================
    // EMITENTE
    // ============================================================

    static adicionarEmitente(xml, emitente) {
        const emit = xml.ele('emit');

        emit.ele('CNPJ').txt(emitente.cnpj.replace(/\D/g, ''));
        emit.ele('xNome').txt(this.sanitizarTextoXML(emitente.razaoSocial));
        if (emitente.nomeFantasia) {
            emit.ele('xFant').txt(this.sanitizarTextoXML(emitente.nomeFantasia));
        }

        const enderEmit = emit.ele('enderEmit');
        enderEmit.ele('xLgr').txt(this.sanitizarTextoXML(emitente.logradouro));
        enderEmit.ele('nro').txt(this.sanitizarTextoXML(emitente.numero));
        if (emitente.complemento) enderEmit.ele('xCpl').txt(this.sanitizarTextoXML(emitente.complemento));
        enderEmit.ele('xBairro').txt(this.sanitizarTextoXML(emitente.bairro));
        enderEmit.ele('cMun').txt(emitente.codigoMunicipio);
        enderEmit.ele('xMun').txt(this.sanitizarTextoXML(emitente.municipio));
        enderEmit.ele('UF').txt(emitente.uf);
        enderEmit.ele('CEP').txt(emitente.cep.replace(/\D/g, ''));
        enderEmit.ele('cPais').txt('1058');
        enderEmit.ele('xPais').txt('Brasil');
        if (emitente.telefone) enderEmit.ele('fone').txt(emitente.telefone.replace(/\D/g, ''));
        enderEmit.up();

        emit.ele('IE').txt(emitente.ie.replace(/\D/g, ''));
        emit.ele('CRT').txt(String(emitente.regimeTributario));

        return emit.up();
    }

    // ============================================================
    // DESTINATÁRIO
    // ============================================================

    static adicionarDestinatario(xml, destinatario) {
        const dest = xml.ele('dest');

        if (destinatario.cnpj) {
            dest.ele('CNPJ').txt(destinatario.cnpj.replace(/\D/g, ''));
        } else if (destinatario.cpf) {
            dest.ele('CPF').txt(destinatario.cpf.replace(/\D/g, ''));
        }

        dest.ele('xNome').txt(this.sanitizarTextoXML(destinatario.nome));

        const enderDest = dest.ele('enderDest');
        enderDest.ele('xLgr').txt(this.sanitizarTextoXML(destinatario.logradouro));
        enderDest.ele('nro').txt(this.sanitizarTextoXML(destinatario.numero));
        if (destinatario.complemento) enderDest.ele('xCpl').txt(this.sanitizarTextoXML(destinatario.complemento));
        enderDest.ele('xBairro').txt(this.sanitizarTextoXML(destinatario.bairro));
        enderDest.ele('cMun').txt(destinatario.codigoMunicipio);
        enderDest.ele('xMun').txt(this.sanitizarTextoXML(destinatario.municipio));
        enderDest.ele('UF').txt(destinatario.uf);
        enderDest.ele('CEP').txt(destinatario.cep.replace(/\D/g, ''));
        enderDest.ele('cPais').txt('1058');
        enderDest.ele('xPais').txt('Brasil');
        if (destinatario.telefone) enderDest.ele('fone').txt(destinatario.telefone.replace(/\D/g, ''));
        enderDest.up();

        // indIEDest: 1=Contribuinte ICMS, 2=Isento, 9=Não contribuinte
        if (destinatario.ie && destinatario.ie !== 'ISENTO') {
            dest.ele('indIEDest').txt('1');
            dest.ele('IE').txt(destinatario.ie.replace(/\D/g, ''));
        } else if (destinatario.ie === 'ISENTO') {
            dest.ele('indIEDest').txt('2');
        } else {
            dest.ele('indIEDest').txt('9');
        }

        if (destinatario.email) {
            dest.ele('email').txt(destinatario.email);
        }

        return dest.up();
    }

    // ============================================================
    // ITEM (det)
    // ============================================================

    static adicionarItem(xml, itemCalculado, numero, emitente, destinatario) {
        const det = xml.ele('det', { nItem: numero });

        // prod
        const prod = det.ele('prod');
        prod.ele('cProd').txt(itemCalculado.item.codigo);
        prod.ele('cEAN').txt(itemCalculado.item.ean || 'SEM GTIN');
        prod.ele('xProd').txt(this.sanitizarTextoXML(itemCalculado.item.descricao));
        prod.ele('NCM').txt(String(itemCalculado.item.ncm).replace(/\D/g, ''));
        if (itemCalculado.item.cest) prod.ele('CEST').txt(String(itemCalculado.item.cest).replace(/\D/g, ''));
        prod.ele('CFOP').txt(String(itemCalculado.item.cfop).replace(/\D/g, ''));
        prod.ele('uCom').txt(itemCalculado.item.unidade);
        prod.ele('qCom').txt(this.formatarDecimal(itemCalculado.item.quantidade, 4));
        prod.ele('vUnCom').txt(this.formatarDecimal(itemCalculado.item.valorUnitario, 10));
        prod.ele('vProd').txt(this.formatarDecimal(itemCalculado.totais.valorBruto, 2));
        prod.ele('cEANTrib').txt(itemCalculado.item.ean || 'SEM GTIN');
        prod.ele('uTrib').txt(itemCalculado.item.unidade);
        prod.ele('qTrib').txt(this.formatarDecimal(itemCalculado.item.quantidade, 4));
        prod.ele('vUnTrib').txt(this.formatarDecimal(itemCalculado.item.valorUnitario, 10));
        if (itemCalculado.totais.valorFrete > 0) prod.ele('vFrete').txt(this.formatarDecimal(itemCalculado.totais.valorFrete, 2));
        if (itemCalculado.totais.valorSeguro > 0) prod.ele('vSeg').txt(this.formatarDecimal(itemCalculado.totais.valorSeguro, 2));
        if (itemCalculado.totais.valorDesconto > 0) prod.ele('vDesc').txt(this.formatarDecimal(itemCalculado.totais.valorDesconto, 2));
        if (itemCalculado.totais.valorOutros > 0) prod.ele('vOutro').txt(this.formatarDecimal(itemCalculado.totais.valorOutros, 2));
        prod.ele('indTot').txt('1');
        prod.up();

        // imposto
        const imposto = det.ele('imposto');
        if (itemCalculado.totais.valorTotalTributos > 0) {
            imposto.ele('vTotTrib').txt(this.formatarDecimal(itemCalculado.totais.valorTotalTributos, 2));
        }

        this.adicionarICMS(imposto, itemCalculado.icms, emitente);

        // IPI vem ANTES de PIS/COFINS no XSD
        if (itemCalculado.ipi && itemCalculado.ipi.valorIPI > 0) {
            this.adicionarIPI(imposto, itemCalculado.ipi);
        }

        this.adicionarPIS(imposto, itemCalculado.pis);
        this.adicionarCOFINS(imposto, itemCalculado.cofins);

        // IBS/CBS — Reforma Tributária (NT 2025.002)
        if (IBSCBSService && itemCalculado.ibsCbs) {
            IBSCBSService.adicionarXMLIBSCBS(imposto, itemCalculado.ibsCbs);
        }

        imposto.up();
        det.up();
    }

    // ============================================================
    // ICMS
    // ============================================================

    static adicionarICMS(imposto, icms, emitente) {
        const icmsNode = imposto.ele('ICMS');

        if (emitente.regimeTributario === 1) {
            // Simples Nacional — tag ICMSSN + CSOSN
            const csosn = icms.csosn || '102';
            const icmsSN = icmsNode.ele(`ICMSSN${csosn}`);
            icmsSN.ele('orig').txt(icms.origem);
            icmsSN.ele('CSOSN').txt(csosn);
            if (csosn === '101') {
                icmsSN.ele('pCredSN').txt(this.formatarDecimal(icms.aliquotaCredito, 4));
                icmsSN.ele('vCredICMSSN').txt(this.formatarDecimal(icms.valorCredito, 2));
            }
            icmsSN.up();
        } else {
            // Regime Normal
            const cst = icms.cst || '00';
            const icmsTag = icmsNode.ele(`ICMS${cst}`);
            icmsTag.ele('orig').txt(icms.origem);
            icmsTag.ele('CST').txt(cst);
            if (icms.baseCalculo > 0) {
                icmsTag.ele('modBC').txt(String(icms.modalidadeBC));
                icmsTag.ele('vBC').txt(this.formatarDecimal(icms.baseCalculo, 2));
                icmsTag.ele('pICMS').txt(this.formatarDecimal(icms.aliquota, 4));
                icmsTag.ele('vICMS').txt(this.formatarDecimal(icms.valorICMS, 2));
            }
            if (icms.valorFCP > 0) {
                icmsTag.ele('pFCP').txt(this.formatarDecimal(icms.aliquotaFCP, 4));
                icmsTag.ele('vFCP').txt(this.formatarDecimal(icms.valorFCP, 2));
            }
            icmsTag.up();
        }

        return icmsNode.up();
    }

    // ============================================================
    // IPI
    // ============================================================

    static adicionarIPI(imposto, ipi) {
        const ipiNode = imposto.ele('IPI');
        ipiNode.ele('cEnq').txt('999');
        const ipiTrib = ipiNode.ele('IPITrib');
        ipiTrib.ele('CST').txt(ipi.cst);
        ipiTrib.ele('vBC').txt(this.formatarDecimal(ipi.baseCalculo, 2));
        ipiTrib.ele('pIPI').txt(this.formatarDecimal(ipi.aliquota, 4));
        ipiTrib.ele('vIPI').txt(this.formatarDecimal(ipi.valorIPI, 2));
        ipiTrib.up();
        return ipiNode.up();
    }

    // ============================================================
    // PIS
    // ============================================================

    static adicionarPIS(imposto, pis) {
        const pisNode = imposto.ele('PIS');
        if (pis.valorPIS > 0) {
            const pisAliq = pisNode.ele('PISAliq');
            pisAliq.ele('CST').txt(pis.cst);
            pisAliq.ele('vBC').txt(this.formatarDecimal(pis.baseCalculo, 2));
            pisAliq.ele('pPIS').txt(this.formatarDecimal(pis.aliquota, 4));
            pisAliq.ele('vPIS').txt(this.formatarDecimal(pis.valorPIS, 2));
            pisAliq.up();
        } else {
            const pisNT = pisNode.ele('PISNT');
            pisNT.ele('CST').txt(pis.cst);
            pisNT.up();
        }
        return pisNode.up();
    }

    // ============================================================
    // COFINS
    // ============================================================

    static adicionarCOFINS(imposto, cofins) {
        const cofinsNode = imposto.ele('COFINS');
        if (cofins.valorCOFINS > 0) {
            const cofinsAliq = cofinsNode.ele('COFINSAliq');
            cofinsAliq.ele('CST').txt(cofins.cst);
            cofinsAliq.ele('vBC').txt(this.formatarDecimal(cofins.baseCalculo, 2));
            cofinsAliq.ele('pCOFINS').txt(this.formatarDecimal(cofins.aliquota, 4));
            cofinsAliq.ele('vCOFINS').txt(this.formatarDecimal(cofins.valorCOFINS, 2));
            cofinsAliq.up();
        } else {
            const cofinsNT = cofinsNode.ele('COFINSNT');
            cofinsNT.ele('CST').txt(cofins.cst);
            cofinsNT.up();
        }
        return cofinsNode.up();
    }

    // ============================================================
    // TOTAL (ICMSTot)
    // ============================================================

    static adicionarTotal(xml, totais) {
        const total = xml.ele('total');
        const icmsTot = total.ele('ICMSTot');

        icmsTot.ele('vBC').txt(this.formatarDecimal(totais.baseCalculoICMS, 2));
        icmsTot.ele('vICMS').txt(this.formatarDecimal(totais.valorICMS, 2));
        icmsTot.ele('vICMSDeson').txt(this.formatarDecimal(totais.valorICMSDesonerado || 0, 2));
        icmsTot.ele('vFCPUFDest').txt(this.formatarDecimal(totais.valorFCPUFDestino || 0, 2));
        icmsTot.ele('vICMSUFDest').txt(this.formatarDecimal(totais.valorICMSUFDestino || 0, 2));
        icmsTot.ele('vICMSUFRemet').txt(this.formatarDecimal(totais.valorICMSUFRemetente || 0, 2));
        icmsTot.ele('vFCP').txt(this.formatarDecimal(totais.valorFCP || 0, 2));
        icmsTot.ele('vBCST').txt(this.formatarDecimal(totais.baseCalculoST || 0, 2));
        icmsTot.ele('vST').txt(this.formatarDecimal(totais.valorST || 0, 2));
        icmsTot.ele('vFCPST').txt(this.formatarDecimal(totais.valorFCPST || 0, 2));
        icmsTot.ele('vFCPSTRet').txt(this.formatarDecimal(totais.valorFCPSTRetido || 0, 2));
        icmsTot.ele('vProd').txt(this.formatarDecimal(totais.valorProdutos, 2));
        icmsTot.ele('vFrete').txt(this.formatarDecimal(totais.valorFrete || 0, 2));
        icmsTot.ele('vSeg').txt(this.formatarDecimal(totais.valorSeguro || 0, 2));
        icmsTot.ele('vDesc').txt(this.formatarDecimal(totais.valorDesconto || 0, 2));
        icmsTot.ele('vII').txt(this.formatarDecimal(totais.valorII || 0, 2));
        icmsTot.ele('vIPI').txt(this.formatarDecimal(totais.valorIPI || 0, 2));
        icmsTot.ele('vIPIDevol').txt(this.formatarDecimal(totais.valorIPIDevolvido || 0, 2));
        icmsTot.ele('vPIS').txt(this.formatarDecimal(totais.valorPIS, 2));
        icmsTot.ele('vCOFINS').txt(this.formatarDecimal(totais.valorCOFINS, 2));
        icmsTot.ele('vOutro').txt(this.formatarDecimal(totais.valorOutros || 0, 2));
        icmsTot.ele('vNF').txt(this.formatarDecimal(totais.valorTotal, 2));
        icmsTot.ele('vTotTrib').txt(this.formatarDecimal(totais.valorTotalTributos || 0, 2));

        // IBS/CBS Totais — Reforma Tributária (NT 2025.002)
        if (totais.totalCBS > 0) {
            icmsTot.ele('vCBS').txt(this.formatarDecimal(totais.totalCBS, 2));
        }
        if (totais.totalIBS > 0) {
            icmsTot.ele('vIBS').txt(this.formatarDecimal(totais.totalIBS, 2));
        }

        icmsTot.up();

        return total.up();
    }

    // ============================================================
    // TRANSPORTE
    // ============================================================

    static adicionarTransporte(xml, transporte) {
        const transp = xml.ele('transp');
        transp.ele('modFrete').txt(transporte?.modalidade || '9');

        if (transporte && transporte.transportadora) {
            const transporta = transp.ele('transporta');
            if (transporte.transportadora.cnpj) {
                transporta.ele('CNPJ').txt(transporte.transportadora.cnpj.replace(/\D/g, ''));
            }
            transporta.ele('xNome').txt(this.sanitizarTextoXML(transporte.transportadora.nome));
            if (transporte.transportadora.ie) transporta.ele('IE').txt(transporte.transportadora.ie);
            if (transporte.transportadora.endereco) transporta.ele('xEnder').txt(this.sanitizarTextoXML(transporte.transportadora.endereco));
            if (transporte.transportadora.municipio) transporta.ele('xMun').txt(this.sanitizarTextoXML(transporte.transportadora.municipio));
            if (transporte.transportadora.uf) transporta.ele('UF').txt(transporte.transportadora.uf);
            transporta.up();
        }

        return transp.up();
    }

    // ============================================================
    // PAGAMENTO — [XSD FIX] Sem indPag (deprecated NT 2016.002)
    // ============================================================

    static adicionarPagamento(xml, pagamento) {
        const pag = xml.ele('pag');

        pagamento.forEach(forma => {
            const detPag = pag.ele('detPag');
            // [XSD FIX] indPag removido — deprecated desde NT 2016.002
            detPag.ele('tPag').txt(forma.forma);
            detPag.ele('vPag').txt(this.formatarDecimal(forma.valor, 2));
            detPag.up();
        });

        return pag.up();
    }

    // ============================================================
    // INFORMAÇÕES ADICIONAIS
    // ============================================================

    static adicionarInformacoesAdicionais(xml, info) {
        const infAdic = xml.ele('infAdic');
        if (info.fisco) infAdic.ele('infAdFisco').txt(this.sanitizarTextoXML(info.fisco));
        if (info.complementar) infAdic.ele('infCpl').txt(this.sanitizarTextoXML(info.complementar));
        return infAdic.up();
    }

    // ============================================================
    // CHAVE DE ACESSO (44 dígitos)
    // ============================================================

    static gerarChaveAcesso(dados) {
        const uf = String(dados.codigoUF).padStart(2, '0');
        const aamm = this.formatarAAMM(dados.dataEmissao);
        const cnpj = dados.emitente.cnpj.replace(/\D/g, '').padStart(14, '0');
        const mod = (dados.modelo || '55').padStart(2, '0');
        const serie = String(dados.serie).padStart(3, '0');
        const numero = String(dados.numeroNFe).padStart(9, '0');
        const tipoEmissao = String(dados.tipoEmissao || '1');
        const codigoNumerico = String(dados.codigoNumerico || this.gerarCodigoNumerico()).padStart(8, '0');

        const chave43 = uf + aamm + cnpj + mod + serie + numero + tipoEmissao + codigoNumerico;
        const dv = this.calcularDigitoVerificador(chave43);

        return chave43 + dv;
    }

    static calcularDigitoVerificador(chave43) {
        const multiplicadores = [2, 3, 4, 5, 6, 7, 8, 9];
        let soma = 0;
        let idx = 0;
        for (let i = chave43.length - 1; i >= 0; i--) {
            soma += parseInt(chave43[i], 10) * multiplicadores[idx];
            idx = (idx + 1) % multiplicadores.length;
        }
        const resto = soma % 11;
        return resto === 0 || resto === 1 ? '0' : String(11 - resto);
    }

    /**
     * [SEC FIX] Gerar código numérico via CSPRNG (não Math.random)
     */
    static gerarCodigoNumerico() {
        return crypto.randomInt(10000000, 99999999);
    }

    static identificarDestinatario(ufEmitente, ufDestinatario) {
        if (!ufDestinatario || ufDestinatario === 'EX') return '3';
        return ufEmitente === ufDestinatario ? '1' : '2';
    }

    // ============================================================
    // FORMATAÇÃO
    // ============================================================

    /**
     * Formatar data/hora para padrão NFe (AAAA-MM-DDTHH:MM:SS±HH:00)
     * Usa o offset real do sistema para evitar erro de timezone.
     */
    static formatarDataHora(data) {
        const d = new Date(data);
        const pad = (n) => String(n).padStart(2, '0');
        // Obter offset real da timezone do servidor
        const offsetMinutes = d.getTimezoneOffset();
        const offsetHours = -Math.floor(offsetMinutes / 60);
        const sign = offsetHours >= 0 ? '+' : '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.abs(offsetHours))}:00`;
    }

    static formatarAAMM(data) {
        const d = new Date(data);
        return d.getFullYear().toString().substring(2) + String(d.getMonth() + 1).padStart(2, '0');
    }

    /**
     * [BUG-002 FIX] Formatar decimal usando Decimal seguro.
     * Elimina drift de IEEE 754 antes de serializar para XML.
     */
    static formatarDecimal(valor, casas) {
        return Decimal.from(valor).toFixed(casas);
    }

    /**
     * [SEC] Sanitizar texto para XML — previne XML injection
     * Remove caracteres de controle, normaliza espaços
     */
    static sanitizarTextoXML(texto) {
        if (!texto) return '';
        return String(texto)
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
            .replace(/\s+/g, ' ')  // Normaliza espaços
            .trim()
            .substring(0, 2000); // Limite de segurança
    }
}

module.exports = XmlNFeService;
