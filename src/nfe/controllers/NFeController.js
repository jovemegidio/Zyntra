/**
 * Controller de emissão de NFe
 * Endpoints para gerar, validar e gerenciar NFe
 * 
 * @module NFeController
 */

const express = require('express');
const router = express.Router();
const XMLService = require('../services/XMLService');
const XSDValidationService = require('../services/XSDValidationService');
const CertificadoService = require('../services/CertificadoService');
const SEFAZService = require('../services/SEFAZService');
const EventoService = require('../services/EventoService');
const DANFEService = require('../services/DANFEService');
const InutilizacaoService = require('../services/InutilizacaoService');

class NFeController {
    constructor(pool) {
        this.pool = pool;
        this.xmlService = new XMLService(pool);
        this.xsdService = new XSDValidationService();
        this.certificadoService = new CertificadoService(pool);
        this.sefazService = new SEFAZService(pool);
        this.eventoService = new EventoService(pool, this.certificadoService);
        this.danfeService = new DANFEService(pool);
        this.inutilizacaoService = new InutilizacaoService(pool, this.certificadoService);
        
        this.setupRoutes();
    }

    setupRoutes() {
        // Emitir NFe
        router.post('/emitir', this.emitirNFe.bind(this));
        
        // Preview XML (sem assinar)
        router.post('/preview', this.previewXML.bind(this));
        
        // Transmitir NFe para SEFAZ (Sprint 3)
        router.post('/:id/transmitir', this.transmitirNFe.bind(this));
        
        // Eventos de NFe (Sprint 4)
        router.post('/:id/cancelar', this.cancelarNFe.bind(this));
        router.post('/:id/cce', this.registrarCCe.bind(this));
        router.get('/:id/eventos', this.listarEventos.bind(this));
        
        // DANFE PDF (Sprint 5)
        router.get('/:id/danfe', this.gerarDANFE.bind(this));
        
        // Inutilização (Sprint 6)
        router.post('/inutilizar', this.inutilizarFaixa.bind(this));
        router.get('/inutilizacoes', this.listarInutilizacoes.bind(this));
        router.get('/sugerir-faixa/:serie', this.sugerirFaixa.bind(this));
        
        // Consultar status do serviço SEFAZ
        router.get('/sefaz/status/:uf', this.consultarStatusSEFAZ.bind(this));
        
        // Consultar protocolo de NFe
        router.get('/:id/protocolo', this.consultarProtocolo.bind(this));
        
        // Obter XML de NFe existente
        router.get('/:id/xml', this.obterXML.bind(this));
        
        // Validar XML
        router.post('/validar', this.validarXML.bind(this));
        
        // Reemitir NFe
        router.post('/:id/reemitir', this.reemitirNFe.bind(this));
        
        // Listar NFes
        router.get('/listar', this.listarNFes.bind(this));
        
        // Buscar NFe por ID
        router.get('/:id', this.buscarNFe.bind(this));
        
        // Cancelar NFe
        router.post('/:id/cancelar', this.cancelarNFe.bind(this));
        
        // Instruções XSD
        router.get('/xsd/instrucoes', this.instrucoesXSD.bind(this));
    }

    /**
     * POST /api/nfe/emitir
     * Emite NFe completa (gera XML, valida, assina, salva)
     */
    async emitirNFe(req, res) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();

            const nfeData = req.body;

            // 1. Gerar XML
            console.log('📄 Gerando XML NFe...');
            const { xml, chaveAcesso, numeroNFe, serie } = await this.xmlService.gerarXMLNFe(nfeData);

            // 2. Validar XML
            console.log('✅ Validando XML...');
            const validacao = await this.xsdService.validar(xml);
            
            if (!validacao.valido) {
                throw new Error(`XML inválido: ${validacao.erros.join(', ')}`);
            }

            // 3. Assinar XML
            console.log('🔏 Assinando XML...');
            const xmlAssinado = await this.certificadoService.assinarXML(xml, nfeData.empresa_id || 1);

            // 4. Salvar no banco
            console.log('💾 Salvando NFe...');
            const [result] = await connection.query(`
                INSERT INTO nfes (
                    numero, serie, modelo, chave_acesso,
                    emitente_cnpj, emitente_nome,
                    destinatario_cnpj_cpf, destinatario_nome,
                    natureza_operacao, tipo_operacao,
                    data_emissao, data_saida,
                    valor_produtos, valor_total,
                    xml_original, xml_assinado,
                    status, ambiente,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                numeroNFe,
                serie,
                nfeData.modelo || '55',
                chaveAcesso,
                nfeData.emitente.cnpj,
                nfeData.emitente.razaoSocial,
                nfeData.destinatario.cnpj || nfeData.destinatario.cpf,
                nfeData.destinatario.nome,
                nfeData.naturezaOperacao,
                nfeData.tipoOperacao || '1',
                nfeData.dataEmissao,
                nfeData.dataSaida || null,
                nfeData.totais.valorProdutos,
                nfeData.totais.valorTotal,
                xml,
                xmlAssinado,
                'emitida',
                nfeData.ambiente || 'homologacao'
            ]);

            const nfeId = result.insertId;

            // 5. Salvar itens
            for (const item of nfeData.itens) {
                await connection.query(`
                    INSERT INTO nfe_itens (
                        nfe_id, numero_item, codigo_produto, descricao,
                        ncm, cfop, unidade, quantidade,
                        valor_unitario, valor_total,
                        base_calculo_icms, aliquota_icms, valor_icms,
                        base_calculo_pis, aliquota_pis, valor_pis,
                        base_calculo_cofins, aliquota_cofins, valor_cofins
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    nfeId,
                    item.numeroItem,
                    item.codigo,
                    item.descricao,
                    item.ncm,
                    item.cfop,
                    item.unidade,
                    item.quantidade,
                    item.valorUnitario,
                    item.quantidade * item.valorUnitario,
                    item.baseCalculoIcms || 0,
                    item.aliquotaIcms || 0,
                    item.valorIcms || 0,
                    item.baseCalculoPis || 0,
                    item.aliquotaPis || 0,
                    item.valorPis || 0,
                    item.baseCalculoCofins || 0,
                    item.aliquotaCofins || 0,
                    item.valorCofins || 0
                ]);
            }

            await connection.commit();

            res.json({
                sucesso: true,
                mensagem: 'NFe emitida com sucesso',
                nfe: {
                    id: nfeId,
                    numero: numeroNFe,
                    serie,
                    chaveAcesso,
                    status: 'emitida'
                },
                validacao: {
                    avisos: validacao.avisos
                }
            });

        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao emitir NFe:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao emitir NFe',
                erro: error.message
            });
        } finally {
            connection.release();
        }
    }

    /**
     * POST /api/nfe/preview
     * Gera preview do XML sem salvar
     */
    async previewXML(req, res) {
        try {
            const nfeData = req.body;

            // Gerar XML
            const { xml, chaveAcesso, numeroNFe, serie } = await this.xmlService.gerarXMLNFe(nfeData);

            // Validar
            const validacao = await this.xsdService.validar(xml);

            res.json({
                sucesso: true,
                xml,
                chaveAcesso,
                numero: numeroNFe,
                serie,
                validacao
            });

        } catch (error) {
            console.error('❌ Erro ao gerar preview:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao gerar preview',
                erro: error.message
            });
        }
    }

    /**
     * GET /api/nfe/:id/xml
     * Retorna XML de NFe (aceita ID numérico ou chave de acesso 44 dígitos)
     */
    async obterXML(req, res) {
        try {
            const nfeId = req.params.id;
            let nfes;

            if (/^\d{44}$/.test(nfeId)) {
                [nfes] = await this.pool.query(
                    'SELECT xml_assinado, xml_original, chave_acesso FROM nfes WHERE chave_acesso = ?',
                    [nfeId]
                );
            } else {
                [nfes] = await this.pool.query(
                    'SELECT xml_assinado, xml_original, chave_acesso FROM nfes WHERE id = ?',
                    [nfeId]
                );
            }

            if (!nfes || nfes.length === 0) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: 'NFe não encontrada'
                });
            }

            const nfe = nfes[0];
            const xml = nfe.xml_assinado || nfe.xml_original;

            res.set('Content-Type', 'application/xml');
            res.set('Content-Disposition', `attachment; filename="NFe${nfe.chave_acesso}.xml"`);
            res.send(xml);

        } catch (error) {
            console.error('❌ Erro ao obter XML:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao obter XML',
                erro: error.message
            });
        }
    }

    /**
     * POST /api/nfe/validar
     * Valida XML fornecido
     */
    async validarXML(req, res) {
        try {
            const { xml } = req.body;

            if (!xml) {
                return res.status(400).json({
                    sucesso: false,
                    mensagem: 'XML não fornecido'
                });
            }

            const validacao = await this.xsdService.validar(xml);

            res.json({
                sucesso: true,
                validacao
            });

        } catch (error) {
            console.error('❌ Erro ao validar XML:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao validar XML',
                erro: error.message
            });
        }
    }

    /**
     * POST /api/nfe/:id/reemitir
     * Reemite NFe com mesmos dados
     */
    async reemitirNFe(req, res) {
        try {
            const nfeId = req.params.id;

            // Buscar NFe original
            const [nfes] = await this.pool.query(
                'SELECT * FROM nfes WHERE id = ?',
                [nfeId]
            );

            if (!nfes || nfes.length === 0) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: 'NFe não encontrada'
                });
            }

            const nfeOriginal = nfes[0];

            // Buscar itens
            const [itens] = await this.pool.query(
                'SELECT * FROM nfe_itens WHERE nfe_id = ? ORDER BY numero_item',
                [nfeId]
            );

            // Reconstruir objeto nfeData
            const nfeData = {
                emitente: {
                    cnpj: nfeOriginal.emitente_cnpj,
                    razaoSocial: nfeOriginal.emitente_nome
                    // ... outros dados do emitente
                },
                destinatario: {
                    cnpj: nfeOriginal.destinatario_cnpj_cpf,
                    nome: nfeOriginal.destinatario_nome
                    // ... outros dados do destinatário
                },
                itens: itens.map(item => ({
                    codigo: item.codigo_produto,
                    descricao: item.descricao,
                    quantidade: item.quantidade,
                    valorUnitario: item.valor_unitario
                    // ... outros dados do item
                })),
                totais: {
                    valorProdutos: nfeOriginal.valor_produtos,
                    valorTotal: nfeOriginal.valor_total
                }
            };

            // Chamar emitirNFe
            req.body = nfeData;
            await this.emitirNFe(req, res);

        } catch (error) {
            console.error('❌ Erro ao reemitir NFe:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao reemitir NFe',
                erro: error.message
            });
        }
    }

    /**
     * GET /api/nfe/listar
     * Lista NFes com filtros
     */
    async listarNFes(req, res) {
        try {
            const { 
                dataInicio, 
                dataFim, 
                status, 
                destinatario,
                limite = 50,
                pagina = 1
            } = req.query;

            let sql = 'SELECT * FROM nfes WHERE 1=1';
            const params = [];

            if (dataInicio) {
                sql += ' AND data_emissao >= ?';
                params.push(dataInicio);
            }

            if (dataFim) {
                sql += ' AND data_emissao <= ?';
                params.push(dataFim);
            }

            if (status) {
                sql += ' AND status = ?';
                params.push(status);
            }

            if (destinatario) {
                sql += ' AND (destinatario_nome LIKE ? OR destinatario_cnpj_cpf LIKE ?)';
                params.push(`%${destinatario}%`, `%${destinatario}%`);
            }

            sql += ' ORDER BY data_emissao DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limite), (parseInt(pagina) - 1) * parseInt(limite));

            const [nfes] = await this.pool.query(sql, params);

            res.json({
                sucesso: true,
                nfes,
                pagina: parseInt(pagina),
                limite: parseInt(limite)
            });

        } catch (error) {
            console.error('❌ Erro ao listar NFes:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao listar NFes',
                erro: error.message
            });
        }
    }

    /**
     * GET /api/nfe/:id
     * Busca NFe por ID ou chave de acesso
     */
    async buscarNFe(req, res) {
        try {
            const nfeId = req.params.id;
            let nfes;

            // Se o parâmetro parece ser uma chave de acesso (44 dígitos numéricos)
            if (/^\d{44}$/.test(nfeId)) {
                [nfes] = await this.pool.query(
                    'SELECT * FROM nfes WHERE chave_acesso = ?',
                    [nfeId]
                );
            } else {
                [nfes] = await this.pool.query(
                    'SELECT * FROM nfes WHERE id = ?',
                    [nfeId]
                );
            }

            if (!nfes || nfes.length === 0) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: 'Nota fiscal não encontrada'
                });
            }

            const [itens] = await this.pool.query(
                'SELECT * FROM nfe_itens WHERE nfe_id = ? ORDER BY numero_item',
                [nfes[0].id]
            );

            res.json({
                sucesso: true,
                nfe: {
                    ...nfes[0],
                    itens
                }
            });

        } catch (error) {
            console.error('❌ Erro ao buscar NFe:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao buscar NFe',
                erro: error.message
            });
        }
    }

    /**
     * POST /api/nfe/:id/cancelar
     * Marca NFe como cancelada (SEFAZ implementado em sprint 3)
     */
    async cancelarNFe(req, res) {
        try {
            const nfeId = req.params.id;
            const { justificativa } = req.body;

            if (!justificativa || justificativa.length < 15) {
                return res.status(400).json({
                    sucesso: false,
                    mensagem: 'Justificativa deve ter no mínimo 15 caracteres'
                });
            }

            // Atualizar status (transmissão SEFAZ será implementada em Sprint 3)
            await this.pool.query(
                'UPDATE nfes SET status = ?, justificativa_cancelamento = ? WHERE id = ?',
                ['cancelada', justificativa, nfeId]
            );

            res.json({
                sucesso: true,
                mensagem: 'NFe marcada como cancelada. Transmissão SEFAZ será implementada em Sprint 3.',
                aviso: 'Este é apenas um cancelamento local. Para cancelamento na SEFAZ, aguarde Sprint 3.'
            });

        } catch (error) {
            console.error('❌ Erro ao cancelar NFe:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao cancelar NFe',
                erro: error.message
            });
        }
    }

    /**
     * GET /api/nfe/xsd/instrucoes
     * Retorna instruções para download de XSD
     */
    async instrucoesXSD(req, res) {
        try {
            const instrucoes = this.xsdService.instrucoes();
            res.json({
                sucesso: true,
                ...instrucoes
            });
        } catch (error) {
            res.status(500).json({
                sucesso: false,
                erro: error.message
            });
        }
    }

    /**
     * POST /api/nfe/:id/transmitir
     * Transmite NFe para SEFAZ (Sprint 3)
     */
    async transmitirNFe(req, res) {
        try {
            const nfeId = req.params.id;

            // Buscar NFe
            const [nfes] = await this.pool.query(
                'SELECT * FROM nfes WHERE id = ?',
                [nfeId]
            );

            if (!nfes || nfes.length === 0) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: 'NFe não encontrada'
                });
            }

            const nfe = nfes[0];

            // Verificar se já foi transmitida
            if (nfe.status === 'autorizada') {
                return res.status(400).json({
                    sucesso: false,
                    mensagem: 'NFe já foi autorizada',
                    protocolo: nfe.protocolo_autorizacao
                });
            }

            // Obter UF do emitente
            const uf = nfe.emitente_uf || 'SP';
            
            // Obter ambiente (homologação/produção)
            const [config] = await this.pool.query(
                'SELECT ambiente FROM nfe_configuracoes WHERE empresa_id = ? LIMIT 1',
                [nfe.empresa_id || 1]
            );
            
            const ambiente = config[0]?.ambiente || 'homologacao';

            console.log(`📤 Transmitindo NFe ${nfe.numero}/${nfe.serie} para SEFAZ ${uf}...`);

            // Transmitir para SEFAZ
            const resultado = await this.sefazService.autorizarNFe(
                nfe.xml_assinado,
                uf,
                ambiente
            );

            // Atualizar status no banco
            if (resultado.cStat === '100') {
                // Autorizada
                await this.pool.query(`
                    UPDATE nfes SET 
                        status = 'autorizada',
                        protocolo_autorizacao = ?,
                        data_autorizacao = NOW(),
                        xml_protocolo = ?
                    WHERE id = ?
                `, [resultado.nProt, JSON.stringify(resultado.xmlProtocolo), nfeId]);

                res.json({
                    sucesso: true,
                    mensagem: 'NFe autorizada com sucesso!',
                    nfe: {
                        numero: nfe.numero,
                        serie: nfe.serie,
                        chaveAcesso: nfe.chave_acesso,
                        protocolo: resultado.nProt,
                        dataAutorizacao: resultado.dhRecbto
                    },
                    sefaz: resultado
                });

            } else if (resultado.cStat === '103') {
                // Lote em processamento
                res.json({
                    sucesso: true,
                    mensagem: 'Lote recebido pela SEFAZ, aguardando processamento',
                    numeroRecibo: resultado.nRec
                });

            } else {
                // Rejeição
                await this.pool.query(`
                    UPDATE nfes SET 
                        status = 'rejeitada',
                        motivo_rejeicao = ?
                    WHERE id = ?
                `, [resultado.xMotivo, nfeId]);

                res.status(400).json({
                    sucesso: false,
                    mensagem: 'NFe rejeitada pela SEFAZ',
                    codigo: resultado.cStat,
                    motivo: resultado.xMotivo
                });
            }

        } catch (error) {
            console.error('❌ Erro ao transmitir NFe:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao transmitir NFe para SEFAZ',
                erro: error.message
            });
        }
    }

    /**
     * GET /api/nfe/sefaz/status/:uf
     * Consulta status do serviço SEFAZ
     */
    async consultarStatusSEFAZ(req, res) {
        try {
            const uf = req.params.uf.toUpperCase();
            const ambiente = req.query.ambiente || 'homologacao';

            console.log(`🔍 Consultando status SEFAZ ${uf}...`);

            const status = await this.sefazService.consultarStatusServico(uf, ambiente);

            res.json({
                sucesso: true,
                uf,
                ambiente,
                status
            });

        } catch (error) {
            console.error('❌ Erro ao consultar status:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao consultar status SEFAZ',
                erro: error.message
            });
        }
    }

    /**
     * GET /api/nfe/:id/protocolo
     * Consulta protocolo de NFe autorizada
     */
    async consultarProtocolo(req, res) {
        try {
            const nfeId = req.params.id;

            // Buscar NFe
            const [nfes] = await this.pool.query(
                'SELECT * FROM nfes WHERE id = ?',
                [nfeId]
            );

            if (!nfes || nfes.length === 0) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: 'NFe não encontrada'
                });
            }

            const nfe = nfes[0];

            // Consultar protocolo na SEFAZ
            const uf = nfe.emitente_uf || 'SP';
            const ambiente = nfe.ambiente || 'homologacao';

            const protocolo = await this.sefazService.consultarProtocolo(
                nfe.chave_acesso,
                uf,
                ambiente
            );

            res.json({
                sucesso: true,
                nfe: {
                    numero: nfe.numero,
                    serie: nfe.serie,
                    chaveAcesso: nfe.chave_acesso
                },
                protocolo
            });

        } catch (error) {
            console.error('❌ Erro ao consultar protocolo:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao consultar protocolo',
                erro: error.message
            });
        }
    }

    /**
     * Cancela NFe autorizada (Sprint 4)
     */
    async cancelarNFe(req, res) {
        try {
            const { id } = req.params;
            const { justificativa, empresaId = 1 } = req.body;

            console.log(`🚫 Recebido cancelamento da NFe ${id}`);

            const resultado = await this.eventoService.cancelarNFe(
                parseInt(id),
                justificativa,
                parseInt(empresaId)
            );

            res.json(resultado);

        } catch (error) {
            console.error('❌ Erro ao cancelar NFe:', error);
            
            res.status(400).json({
                sucesso: false,
                mensagem: error.message
            });
        }
    }

    /**
     * Registra Carta de Correção Eletrônica (Sprint 4)
     */
    async registrarCCe(req, res) {
        try {
            const { id } = req.params;
            const { correcao, empresaId = 1 } = req.body;

            console.log(`📝 Recebida CCe para NFe ${id}`);

            const resultado = await this.eventoService.registrarCCe(
                parseInt(id),
                correcao,
                parseInt(empresaId)
            );

            res.json(resultado);

        } catch (error) {
            console.error('❌ Erro ao registrar CCe:', error);
            
            res.status(400).json({
                sucesso: false,
                mensagem: error.message
            });
        }
    }

    /**
     * Lista eventos de uma NFe (Sprint 4)
     */
    async listarEventos(req, res) {
        try {
            const { id } = req.params;

            const eventos = await this.eventoService.listarEventos(parseInt(id));

            res.json({
                sucesso: true,
                quantidade: eventos.length,
                eventos
            });

        } catch (error) {
            console.error('❌ Erro ao listar eventos:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao listar eventos',
                erro: error.message
            });
        }
    }

    /**
     * Gera DANFE em PDF (Sprint 5)
     */
    async gerarDANFE(req, res) {
        try {
            const { id } = req.params;

            console.log(`📄 Solicitação de DANFE para NFe ${id}`);

            const pdfBuffer = await this.danfeService.gerarDANFE(parseInt(id));

            // Buscar número da NFe para nome do arquivo
            const [nfes] = await this.pool.query('SELECT numero, serie FROM nfes WHERE id = ?', [id]);
            const nfe = nfes[0];

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="DANFE_NFe_${nfe.serie}_${nfe.numero}.pdf"`);
            res.send(pdfBuffer);

        } catch (error) {
            console.error('❌ Erro ao gerar DANFE:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao gerar DANFE',
                erro: error.message
            });
        }
    }

    /**
     * Inutiliza faixa de números (Sprint 6)
     */
    async inutilizarFaixa(req, res) {
        try {
            const dados = req.body;

            console.log(`🚫 Solicitação de inutilização: série ${dados.serie}, números ${dados.numeroInicial}-${dados.numeroFinal}`);

            const resultado = await this.inutilizacaoService.inutilizarFaixa(dados);

            res.json(resultado);

        } catch (error) {
            console.error('❌ Erro ao inutilizar faixa:', error);
            
            res.status(400).json({
                sucesso: false,
                mensagem: error.message
            });
        }
    }

    /**
     * Lista inutilizações (Sprint 6)
     */
    async listarInutilizacoes(req, res) {
        try {
            const filtros = {
                serie: req.query.serie,
                ano: req.query.ano,
                uf: req.query.uf
            };

            const inutilizacoes = await this.inutilizacaoService.listarInutilizacoes(filtros);

            res.json({
                sucesso: true,
                quantidade: inutilizacoes.length,
                inutilizacoes
            });

        } catch (error) {
            console.error('❌ Erro ao listar inutilizações:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao listar inutilizações',
                erro: error.message
            });
        }
    }

    /**
     * Sugere próxima faixa para inutilização (Sprint 6)
     */
    async sugerirFaixa(req, res) {
        try {
            const { serie } = req.params;
            const anoAtual = new Date().getFullYear();

            const sugestao = await this.inutilizacaoService.sugerirProximaFaixa(
                parseInt(serie),
                anoAtual
            );

            res.json({
                sucesso: true,
                sugestao
            });

        } catch (error) {
            console.error('❌ Erro ao sugerir faixa:', error);
            
            res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao sugerir faixa',
                erro: error.message
            });
        }
    }

    getRouter() {
        return router;
    }
}

module.exports = NFeController;
