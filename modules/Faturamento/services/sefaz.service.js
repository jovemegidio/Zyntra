/**
 * SERVIÇO DE INTEGRAÇÃO COM SEFAZ — REFATORADO
 * Comunicação completa com webservices SEFAZ NFe 4.00
 *
 * CORREÇÕES APLICADAS:
 * [BUG-007] gerarIdLote usa crypto.randomInt (CSPRNG) — não mais Math.random
 * [BUG-008] UF dinâmica — removido hardcode '35' (SP)
 * [BUG-009] Parsing XML via xmlbuilder2 — removido regex frágil
 * [BUG-010] Retry com exponential backoff para timeouts SOAP
 * [BUG-011] httpsAgent recebe PEM strings — não mais forge objects
 */

'use strict';

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const builder = require('xmlbuilder2');
const nfeConfig = require('../config/nfe.config');
const certificadoService = require('./certificado.service');

// Constantes de retry
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

class SefazService {

    // ============================================================
    // SERVIÇOS PÚBLICOS
    // ============================================================

    /**
     * Enviar NFe para autorização
     */
    async autorizarNFe(xmlNFe, uf) {
        try {
            const idLote = this.gerarIdLote();
            const xmlEnvio = this.criarEnvioLote(idLote, [xmlNFe]);

            // Assinar XML
            const xmlAssinado = await certificadoService.assinarXML(xmlEnvio, 'infNFe');

            // Resolver URL dinâmica
            const url = this.resolverURL(uf, 'autorizacao');

            const soapEnvelope = this.criarSOAPEnvelope('NFeAutorizacao4', xmlAssinado);
            const response = await this.enviarRequisicaoSOAP(url, soapEnvelope);

            const resultado = this.parseXmlResponse(response.data, ['cStat', 'xMotivo', 'nRec', 'nProt', 'chNFe']);

            // Se processamento assíncrono (103), consultar recibo
            if (resultado.cStat === '103' && resultado.nRec) {
                return await this.consultarRecibo(resultado.nRec, uf);
            }

            return {
                codigoStatus: resultado.cStat,
                motivo: resultado.xMotivo,
                numeroProtocolo: resultado.nProt || null,
                chaveAcesso: resultado.chNFe || null,
                autorizado: resultado.cStat === '100',
                xmlCompleto: response.data
            };
        } catch (error) {
            throw new Error(`Erro ao autorizar NFe: ${error.message}`);
        }
    }

    /**
     * Consultar recibo de lote
     */
    async consultarRecibo(numeroRecibo, uf) {
        try {
            const xmlConsulta = this.criarConsultaRecibo(numeroRecibo);

            const url = this.resolverURL(uf, 'retAutorizacao');
            const soapEnvelope = this.criarSOAPEnvelope('NFeRetAutorizacao4', xmlConsulta);
            const response = await this.enviarRequisicaoSOAP(url, soapEnvelope);

            const resultado = this.parseXmlResponse(response.data, ['cStat', 'xMotivo', 'nProt', 'chNFe']);

            return {
                codigoStatus: resultado.cStat,
                motivo: resultado.xMotivo,
                numeroProtocolo: resultado.nProt || null,
                chaveAcesso: resultado.chNFe || null,
                autorizado: resultado.cStat === '100',
                xmlCompleto: response.data
            };
        } catch (error) {
            throw new Error(`Erro ao consultar recibo: ${error.message}`);
        }
    }

    /**
     * Consultar NFe por chave de acesso
     */
    async consultarNFe(chaveAcesso, uf) {
        try {
            const xmlConsulta = this.criarConsultaNFe(chaveAcesso);

            const url = this.resolverURL(uf, 'consulta');
            const soapEnvelope = this.criarSOAPEnvelope('NfeConsultaProtocolo4', xmlConsulta);
            const response = await this.enviarRequisicaoSOAP(url, soapEnvelope);

            const resultado = this.parseXmlResponse(response.data, ['cStat', 'xMotivo', 'nProt', 'chNFe']);

            return {
                codigoStatus: resultado.cStat,
                motivo: resultado.xMotivo,
                numeroProtocolo: resultado.nProt || null,
                chaveAcesso: resultado.chNFe || null,
                autorizado: resultado.cStat === '100',
                xmlCompleto: response.data
            };
        } catch (error) {
            throw new Error(`Erro ao consultar NFe: ${error.message}`);
        }
    }

    /**
     * Cancelar NFe
     */
    async cancelarNFe(chaveAcesso, numeroProtocolo, justificativa, uf, cnpj) {
        try {
            if (!justificativa || justificativa.length < 15) {
                throw new Error('Justificativa deve ter no mínimo 15 caracteres');
            }

            const xmlEvento = this.criarEventoCancelamento({
                chaveAcesso,
                numeroProtocolo,
                justificativa,
                cnpj,
                sequenciaEvento: 1
            });

            return await this.enviarEvento(xmlEvento, uf);
        } catch (error) {
            throw new Error(`Erro ao cancelar NFe: ${error.message}`);
        }
    }

    /**
     * Carta de Correção Eletrônica (CC-e)
     */
    async cartaCorrecao(chaveAcesso, correcao, uf, cnpj, sequencia = 1) {
        try {
            if (!correcao || correcao.length < 15) {
                throw new Error('Correção deve ter no mínimo 15 caracteres');
            }

            const xmlEvento = this.criarEventoCartaCorrecao({
                chaveAcesso,
                correcao,
                cnpj,
                sequenciaEvento: sequencia
            });

            return await this.enviarEvento(xmlEvento, uf);
        } catch (error) {
            throw new Error(`Erro ao enviar carta de correção: ${error.message}`);
        }
    }

    /**
     * Inutilizar numeração
     * [BUG-008 FIX] recebe UF como parâmetro, não hardcoded '35'
     */
    async inutilizarNumeracao(dados, uf) {
        try {
            const { ano, cnpj, modelo, serie, numeroInicial, numeroFinal, justificativa } = dados;

            if (!justificativa || justificativa.length < 15) {
                throw new Error('Justificativa deve ter no mínimo 15 caracteres');
            }

            // [BUG-008 FIX] Resolver código UF dinâmico
            const codigoUF = this.resolverCodigoUF(uf);

            const xmlInutilizacao = this.criarInutilizacao({
                ano, cnpj, modelo, serie, numeroInicial, numeroFinal, justificativa, codigoUF
            });

            const xmlAssinado = await certificadoService.assinarXML(xmlInutilizacao, 'infInut');

            const url = this.resolverURL(uf, 'inutilizacao');
            const soapEnvelope = this.criarSOAPEnvelope('NfeInutilizacao4', xmlAssinado);
            const response = await this.enviarRequisicaoSOAP(url, soapEnvelope);

            const resultado = this.parseXmlResponse(response.data, ['cStat', 'xMotivo']);

            return {
                codigoStatus: resultado.cStat,
                motivo: resultado.xMotivo,
                sucesso: resultado.cStat === '102',
                xmlCompleto: response.data
            };
        } catch (error) {
            throw new Error(`Erro ao inutilizar numeração: ${error.message}`);
        }
    }

    /**
     * Consultar status do serviço SEFAZ
     * [BUG-008 FIX] recebe UF como parâmetro obrigatório
     */
    async consultarStatusServico(uf) {
        try {
            if (!uf) throw new Error('UF é obrigatória para consultar status');

            const codigoUF = this.resolverCodigoUF(uf);
            const xmlConsulta = this.criarConsultaStatus(codigoUF);

            const url = this.resolverURL(uf, 'statusServico');
            const soapEnvelope = this.criarSOAPEnvelope('NfeStatusServico4', xmlConsulta);
            const response = await this.enviarRequisicaoSOAP(url, soapEnvelope);

            const resultado = this.parseXmlResponse(response.data, ['cStat', 'xMotivo']);

            return {
                codigoStatus: resultado.cStat,
                motivo: resultado.xMotivo,
                online: resultado.cStat === '107',
                xmlCompleto: response.data
            };
        } catch (error) {
            throw new Error(`Erro ao consultar status: ${error.message}`);
        }
    }

    /**
     * Enviar evento genérico (cancelamento, CC-e, etc.)
     */
    async enviarEvento(xmlEvento, uf) {
        try {
            const xmlAssinado = await certificadoService.assinarXML(xmlEvento, 'infEvento');
            const xmlEnvio = this.criarEnvioEvento(xmlAssinado);

            const url = this.resolverURL(uf, 'eventos');
            const soapEnvelope = this.criarSOAPEnvelope('RecepcaoEvento4', xmlEnvio);
            const response = await this.enviarRequisicaoSOAP(url, soapEnvelope);

            const resultado = this.parseXmlResponse(response.data, ['cStat', 'xMotivo', 'nProt']);

            return {
                codigoStatus: resultado.cStat,
                motivo: resultado.xMotivo,
                numeroProtocolo: resultado.nProt || null,
                sucesso: resultado.cStat === '135' || resultado.cStat === '136',
                xmlCompleto: response.data
            };
        } catch (error) {
            throw new Error(`Erro ao enviar evento: ${error.message}`);
        }
    }

    // ============================================================
    // CRIAÇÃO DE XMLs
    // ============================================================

    criarEnvioLote(idLote, xmlsNFe) {
        const root = builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('enviNFe', {
                versao: '4.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            });

        root.ele('idLote').txt(idLote);
        root.ele('indSinc').txt('1'); // Síncrono

        xmlsNFe.forEach(xml => {
            root.import(builder.create(xml).first());
        });

        return root.end({ prettyPrint: false });
    }

    criarConsultaRecibo(numeroRecibo) {
        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('consReciNFe', {
                versao: '4.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('tpAmb').txt(String(nfeConfig.ambiente)).up()
            .ele('nRec').txt(numeroRecibo)
            .end({ prettyPrint: false });
    }

    criarConsultaNFe(chaveAcesso) {
        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('consSitNFe', {
                versao: '4.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('tpAmb').txt(String(nfeConfig.ambiente)).up()
            .ele('xServ').txt('CONSULTAR').up()
            .ele('chNFe').txt(chaveAcesso)
            .end({ prettyPrint: false });
    }

    criarEventoCancelamento(dados) {
        const { chaveAcesso, numeroProtocolo, justificativa, cnpj, sequenciaEvento } = dados;
        const id = `ID110111${chaveAcesso}${String(sequenciaEvento).padStart(2, '0')}`;

        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('evento', {
                versao: '1.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('infEvento', { Id: id })
            .ele('cOrgao').txt(chaveAcesso.substring(0, 2)).up()
            .ele('tpAmb').txt(String(nfeConfig.ambiente)).up()
            .ele('CNPJ').txt(cnpj.replace(/\D/g, '')).up()
            .ele('chNFe').txt(chaveAcesso).up()
            .ele('dhEvento').txt(this.formatarDataHoraEvento()).up()
            .ele('tpEvento').txt('110111').up()
            .ele('nSeqEvento').txt(String(sequenciaEvento)).up()
            .ele('verEvento').txt('1.00').up()
            .ele('detEvento', { versao: '1.00' })
            .ele('descEvento').txt('Cancelamento').up()
            .ele('nProt').txt(numeroProtocolo).up()
            .ele('xJust').txt(justificativa)
            .end({ prettyPrint: false });
    }

    criarEventoCartaCorrecao(dados) {
        const { chaveAcesso, correcao, cnpj, sequenciaEvento } = dados;
        const id = `ID110110${chaveAcesso}${String(sequenciaEvento).padStart(2, '0')}`;

        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('evento', {
                versao: '1.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('infEvento', { Id: id })
            .ele('cOrgao').txt(chaveAcesso.substring(0, 2)).up()
            .ele('tpAmb').txt(String(nfeConfig.ambiente)).up()
            .ele('CNPJ').txt(cnpj.replace(/\D/g, '')).up()
            .ele('chNFe').txt(chaveAcesso).up()
            .ele('dhEvento').txt(this.formatarDataHoraEvento()).up()
            .ele('tpEvento').txt('110110').up()
            .ele('nSeqEvento').txt(String(sequenciaEvento)).up()
            .ele('verEvento').txt('1.00').up()
            .ele('detEvento', { versao: '1.00' })
            .ele('descEvento').txt('Carta de Correcao').up()
            .ele('xCorrecao').txt(correcao).up()
            .ele('xCondUso').txt('A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.')
            .end({ prettyPrint: false });
    }

    /**
     * [BUG-008 FIX] Inutilização com UF dinâmica
     */
    criarInutilizacao(dados) {
        const { ano, cnpj, modelo, serie, numeroInicial, numeroFinal, justificativa, codigoUF } = dados;
        const cnpjLimpo = cnpj.replace(/\D/g, '');
        const id = `ID${codigoUF}${ano}${cnpjLimpo}${modelo}${String(serie).padStart(3, '0')}${String(numeroInicial).padStart(9, '0')}${String(numeroFinal).padStart(9, '0')}`;

        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('inutNFe', {
                versao: '4.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('infInut', { Id: id })
            .ele('tpAmb').txt(String(nfeConfig.ambiente)).up()
            .ele('xServ').txt('INUTILIZAR').up()
            .ele('cUF').txt(String(codigoUF)).up()
            .ele('ano').txt(String(ano)).up()
            .ele('CNPJ').txt(cnpjLimpo).up()
            .ele('mod').txt(String(modelo)).up()
            .ele('serie').txt(String(serie)).up()
            .ele('nNFIni').txt(String(numeroInicial)).up()
            .ele('nNFFin').txt(String(numeroFinal)).up()
            .ele('xJust').txt(justificativa)
            .end({ prettyPrint: false });
    }

    /**
     * [BUG-008 FIX] Status com UF dinâmica
     */
    criarConsultaStatus(codigoUF) {
        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('consStatServ', {
                versao: '4.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('tpAmb').txt(String(nfeConfig.ambiente)).up()
            .ele('cUF').txt(String(codigoUF)).up()
            .ele('xServ').txt('STATUS')
            .end({ prettyPrint: false });
    }

    criarEnvioEvento(xmlEvento) {
        return builder.create({ version: '1.0', encoding: 'UTF-8' })
            .ele('envEvento', {
                versao: '1.00',
                xmlns: 'http://www.portalfiscal.inf.br/nfe'
            })
            .ele('idLote').txt(this.gerarIdLote()).up()
            .import(builder.create(xmlEvento).first())
            .end({ prettyPrint: false });
    }

    criarSOAPEnvelope(metodo, xmlDados) {
        return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${metodo}">${xmlDados}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    }

    // ============================================================
    // COMUNICAÇÃO SOAP COM RETRY
    // ============================================================

    /**
     * [BUG-010 FIX] Enviar requisição SOAP com exponential backoff
     * [BUG-011 FIX] httpsAgent recebe PEM strings, não forge objects
     */
    async enviarRequisicaoSOAP(url, soapEnvelope) {
        const isProduction = process.env.NODE_ENV === 'production';

        // [BUG-011 FIX] Converter forge cert/key para PEM strings
        const certPem = certificadoService.getCertificadoPEM();
        const keyPem = certificadoService.getChavePrivadaPEM();

        const httpsAgent = new https.Agent({
            rejectUnauthorized: isProduction,
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.3',
            cert: certPem,   // PEM string
            key: keyPem       // PEM string
        });

        let lastError = null;

        // [BUG-010 FIX] Retry com exponential backoff
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await axios.post(url, soapEnvelope, {
                    headers: {
                        'Content-Type': 'application/soap+xml; charset=utf-8'
                    },
                    httpsAgent,
                    timeout: nfeConfig.timeout || 30000
                });

                // Log em modo debug
                if (process.env.NFE_DEBUG === 'true') {
                    console.log(`[SEFAZ] << Resposta status HTTP ${response.status} de ${url}`);
                }

                return response;
            } catch (error) {
                lastError = error;

                // Só faz retry em erros transitórios (timeout, network, 5xx)
                const isRetryable = error.code === 'ECONNABORTED'  // timeout
                    || error.code === 'ECONNRESET'
                    || error.code === 'ENOTFOUND'
                    || error.code === 'ETIMEDOUT'
                    || (error.response && error.response.status >= 500);

                if (!isRetryable || attempt === MAX_RETRIES) {
                    break;
                }

                // Exponential backoff com jitter
                const delay = Math.min(
                    BASE_DELAY_MS * Math.pow(2, attempt) + crypto.randomInt(0, 1000),
                    MAX_DELAY_MS
                );
                console.warn(`[SEFAZ] ⚠ Tentativa ${attempt + 1}/${MAX_RETRIES} falhou (${error.code || error.message}). Retry em ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    // ============================================================
    // PARSING XML SEGURO
    // ============================================================

    /**
     * [BUG-009 FIX] Parse XML via xmlbuilder2 — não mais regex frágil.
     * Extrai campos solicitados do XML de resposta SEFAZ.
     */
    parseXmlResponse(xmlString, campos) {
        const resultado = {};
        try {
            const doc = builder.create(xmlString);
            const obj = doc.end({ format: 'object' });

            // Buscar campos recursivamente no objeto
            const buscar = (node, campo) => {
                if (node === null || node === undefined) return undefined;
                if (typeof node !== 'object') return undefined;
                if (campo in node) return typeof node[campo] === 'object' ? node[campo]['#'] || node[campo] : node[campo];
                for (const key of Object.keys(node)) {
                    const found = buscar(node[key], campo);
                    if (found !== undefined) return found;
                }
                return undefined;
            };

            for (const campo of campos) {
                const valor = buscar(obj, campo);
                resultado[campo] = valor !== undefined ? String(valor) : null;
            }
        } catch (parseError) {
            console.error('[SEFAZ] Erro ao parsear resposta XML:', parseError.message);
            // Fallback: try regex (last resort)
            for (const campo of campos) {
                const match = xmlString.match(new RegExp(`<${campo}>(.*?)</${campo}>`));
                resultado[campo] = match ? match[1] : null;
            }
        }
        return resultado;
    }

    // ============================================================
    // UTILITÁRIOS
    // ============================================================

    /**
     * [BUG-008 FIX] Resolver URL do webservice por UF + serviço
     */
    resolverURL(uf, servico) {
        const ambiente = parseInt(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao';
        const autorizador = nfeConfig.autorizadores[uf] || 'SVRS';
        const url = nfeConfig.webservices[ambiente]?.[autorizador]?.[servico];

        if (!url) {
            throw new Error(`Webservice '${servico}' não configurado para UF ${uf} (autorizador: ${autorizador}, ambiente: ${ambiente})`);
        }
        return url;
    }

    /**
     * [BUG-008 FIX] Resolver código numérico da UF
     */
    resolverCodigoUF(uf) {
        const estado = nfeConfig.estados[uf];
        if (!estado) throw new Error(`UF inválida: ${uf}`);
        return String(estado.codigo);
    }

    /**
     * [BUG-007 FIX] Gerar ID de lote via CSPRNG
     */
    gerarIdLote() {
        return String(crypto.randomInt(100000000000000, 999999999999999));
    }

    formatarDataHoraEvento() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const offsetMinutes = d.getTimezoneOffset();
        const offsetHours = -Math.floor(offsetMinutes / 60);
        const sign = offsetHours >= 0 ? '+' : '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.abs(offsetHours))}:00`;
    }
}

module.exports = new SefazService();
