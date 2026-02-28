/**
 * API de Manifestação do Destinatário e-MDF
 * 
 * OBRIGATÓRIO por lei para todos os destinatários de NFe
 * 
 * Eventos disponíveis:
 * - 210200: Confirmação da Operação
 * - 210210: Ciência da Operação
 * - 210220: Desconhecimento da Operação
 * - 210240: Operação não Realizada
 * 
 * Referência: NT 2012/002 - Manifestação do Destinatário
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const path = require('path');

// Importar serviço real de integração SEFAZ
let ManifestacaoSefazService = null;
try {
    const sefazModule = require(path.join(__dirname, '..', '..', 'Faturamento', 'services', 'manifestacao-sefaz.service.js'));
    ManifestacaoSefazService = sefazModule.ManifestacaoSefazService;
    console.log('✅ [MD-e] Serviço SEFAZ real carregado');
} catch (e) {
    console.warn('⚠️ [MD-e] Serviço SEFAZ não disponível, usando modo local:', e.message);
}

// JWT_SECRET para validação de tokens
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [NFe/manifestacao] ERRO: JWT_SECRET não definido');
}

// Middleware de autenticação
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Token de autenticação não fornecido' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token inválido ou expirado' });
        }
        req.user = user;
        next();
    });
}

// Aplicar autenticação a TODAS as rotas deste router (exceto /eventos e /status que são informativas)
router.use((req, res, next) => {
    // Rotas públicas de consulta de metadados
    if (req.path === '/eventos' || req.path === '/status') {
        return next();
    }
    return authenticateToken(req, res, next);
});

// Códigos de eventos de manifestação
const EVENTOS_MANIFESTACAO = {
    '210200': {
        nome: 'Confirmação da Operação',
        descricao: 'Confirma que a operação descrita na NFe foi realizada',
        obrigatorio: false,
        prazo: 'Sem prazo definido',
        revogavel: false
    },
    '210210': {
        nome: 'Ciência da Operação',
        descricao: 'Indica que o destinatário tem ciência da existência da NFe',
        obrigatorio: false,
        prazo: 'Recomendado em até 180 dias',
        revogavel: true
    },
    '210220': {
        nome: 'Desconhecimento da Operação',
        descricao: 'O destinatário declara que desconhece a operação',
        obrigatorio: false,
        prazo: 'Sem prazo definido',
        revogavel: true
    },
    '210240': {
        nome: 'Operação não Realizada',
        descricao: 'A operação não foi realizada conforme descrita na NFe',
        obrigatorio: true,
        prazo: 'Recomendado assim que identificado o problema',
        revogavel: false,
        requerJustificativa: true
    }
};

// Status possíveis da manifestação
const STATUS_MANIFESTACAO = {
    'PENDENTE': 'NFe aguardando manifestação',
    'CIENCIA': 'Ciência da operação registrada',
    'CONFIRMADA': 'Operação confirmada',
    'DESCONHECIDA': 'Operação desconhecida pelo destinatário',
    'NAO_REALIZADA': 'Operação não realizada'
};

/**
 * GET /eventos - Lista tipos de eventos disponíveis
 */
router.get('/eventos', (req, res) => {
    res.json({
        success: true,
        eventos: EVENTOS_MANIFESTACAO
    });
});

/**
 * GET /status - Lista status possíveis
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        status: STATUS_MANIFESTACAO
    });
});

/**
 * POST /ciencia - Registra Ciência da Operação (210210)
 * 
 * Este é geralmente o primeiro evento a ser registrado quando
 * a empresa toma conhecimento de uma NFe destinada a ela.
 */
router.post('/ciencia', [
    body('chaveNFe').isLength({ min: 44, max: 44 }).isNumeric().withMessage('Chave NFe deve ter 44 dígitos numéricos'),
    body('cnpjDestinatario').isLength({ min: 14, max: 14 }).isNumeric().withMessage('CNPJ deve ter 14 dígitos numéricos'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { chaveNFe, cnpjDestinatario } = req.body;

        // Tentar envio real para SEFAZ
        if (ManifestacaoSefazService && global.dbPool) {
            try {
                const resultado = await ManifestacaoSefazService.enviarManifestacao(global.dbPool, {
                    chaveNFe,
                    tipoEvento: '210210',
                    userId: req.user?.id
                });
                return res.json({
                    success: resultado.sucesso,
                    evento: '210210',
                    descricao: EVENTOS_MANIFESTACAO['210210'].nome,
                    chaveNFe,
                    protocolo: resultado.protocolo,
                    codigoRetorno: resultado.codigoRetorno,
                    motivo: resultado.motivo,
                    integracaoSEFAZ: true
                });
            } catch (sefazError) {
                console.warn('[MD-e] Falha SEFAZ, gerando local:', sefazError.message);
            }
        }

        // Fallback: gerar evento localmente
        const evento = gerarEventoManifestacao({
            chaveNFe,
            cnpjDestinatario,
            tipoEvento: '210210',
            sequencia: 1
        });

        res.json({
            success: true,
            evento: '210210',
            descricao: EVENTOS_MANIFESTACAO['210210'].nome,
            chaveNFe: chaveNFe,
            xml: evento,
            status: 'GERADO',
            integracaoSEFAZ: false,
            mensagem: 'Evento de Ciência gerado. Pronto para envio à SEFAZ.',
            proximosPasso: [
                'Enviar evento para webservice da SEFAZ',
                'Aguardar protocolo de autorização',
                'Após recebimento físico, registrar Confirmação (210200)'
            ]
        });
    } catch (error) {
        console.error('Erro ao gerar ciência:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar evento', error: error.message });
    }
});

/**
 * POST /confirmar - Registra Confirmação da Operação (210200)
 * 
 * Deve ser registrado após o recebimento físico da mercadoria.
 * EVENTO IRREVERSÍVEL.
 */
router.post('/confirmar', [
    body('chaveNFe').isLength({ min: 44, max: 44 }).isNumeric().withMessage('Chave NFe deve ter 44 dígitos numéricos'),
    body('cnpjDestinatario').isLength({ min: 14, max: 14 }).isNumeric().withMessage('CNPJ deve ter 14 dígitos numéricos'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { chaveNFe, cnpjDestinatario, sequencia } = req.body;

        // Tentar envio real para SEFAZ
        if (ManifestacaoSefazService && global.dbPool) {
            try {
                const resultado = await ManifestacaoSefazService.enviarManifestacao(global.dbPool, {
                    chaveNFe,
                    tipoEvento: '210200',
                    userId: req.user?.id
                });
                return res.json({
                    success: resultado.sucesso,
                    evento: '210200',
                    descricao: EVENTOS_MANIFESTACAO['210200'].nome,
                    chaveNFe,
                    protocolo: resultado.protocolo,
                    codigoRetorno: resultado.codigoRetorno,
                    motivo: resultado.motivo,
                    alerta: '⚠️ ATENÇÃO: Este evento é IRREVERSÍVEL.',
                    integracaoSEFAZ: true
                });
            } catch (sefazError) {
                console.warn('[MD-e] Falha SEFAZ, gerando local:', sefazError.message);
            }
        }

        // Fallback local
        const evento = gerarEventoManifestacao({
            chaveNFe,
            cnpjDestinatario,
            tipoEvento: '210200',
            sequencia: sequencia || 1
        });

        res.json({
            success: true,
            evento: '210200',
            descricao: EVENTOS_MANIFESTACAO['210200'].nome,
            chaveNFe: chaveNFe,
            xml: evento,
            status: 'GERADO',
            integracaoSEFAZ: false,
            alerta: '⚠️ ATENÇÃO: Este evento é IRREVERSÍVEL. Após confirmação, não será possível reverter.',
            mensagem: 'Evento de Confirmação gerado. Pronto para envio à SEFAZ.'
        });
    } catch (error) {
        console.error('Erro ao gerar confirmação:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar evento', error: error.message });
    }
});

/**
 * POST /desconhecer - Registra Desconhecimento da Operação (210220)
 * 
 * Usado quando a empresa destinatária não reconhece a operação.
 */
router.post('/desconhecer', [
    body('chaveNFe').isLength({ min: 44, max: 44 }).isNumeric().withMessage('Chave NFe deve ter 44 dígitos numéricos'),
    body('cnpjDestinatario').isLength({ min: 14, max: 14 }).isNumeric().withMessage('CNPJ deve ter 14 dígitos numéricos'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { chaveNFe, cnpjDestinatario, sequencia } = req.body;

        // Tentar envio real para SEFAZ
        if (ManifestacaoSefazService && global.dbPool) {
            try {
                const resultado = await ManifestacaoSefazService.enviarManifestacao(global.dbPool, {
                    chaveNFe,
                    tipoEvento: '210220',
                    userId: req.user?.id
                });
                return res.json({
                    success: resultado.sucesso,
                    evento: '210220',
                    descricao: EVENTOS_MANIFESTACAO['210220'].nome,
                    chaveNFe,
                    protocolo: resultado.protocolo,
                    codigoRetorno: resultado.codigoRetorno,
                    motivo: resultado.motivo,
                    observacao: 'Este evento pode ser substituído por Confirmação ou Operação não Realizada posteriormente.',
                    integracaoSEFAZ: true
                });
            } catch (sefazError) {
                console.warn('[MD-e] Falha SEFAZ desconhecimento, gerando local:', sefazError.message);
            }
        }

        // Fallback local
        const evento = gerarEventoManifestacao({
            chaveNFe,
            cnpjDestinatario,
            tipoEvento: '210220',
            sequencia: sequencia || 1
        });

        res.json({
            success: true,
            evento: '210220',
            descricao: EVENTOS_MANIFESTACAO['210220'].nome,
            chaveNFe: chaveNFe,
            xml: evento,
            status: 'GERADO',
            integracaoSEFAZ: false,
            mensagem: 'Evento de Desconhecimento gerado. A SEFAZ notificará o emitente.',
            observacao: 'Este evento pode ser substituído por Confirmação ou Operação não Realizada posteriormente.'
        });
    } catch (error) {
        console.error('Erro ao gerar desconhecimento:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar evento', error: error.message });
    }
});

/**
 * POST /nao-realizada - Registra Operação não Realizada (210240)
 * 
 * Usado quando a operação descrita na NFe não foi efetivamente realizada.
 * Requer justificativa obrigatória.
 */
router.post('/nao-realizada', [
    body('chaveNFe').isLength({ min: 44, max: 44 }).isNumeric().withMessage('Chave NFe deve ter 44 dígitos numéricos'),
    body('cnpjDestinatario').isLength({ min: 14, max: 14 }).isNumeric().withMessage('CNPJ deve ter 14 dígitos numéricos'),
    body('justificativa').isLength({ min: 15, max: 255 }).withMessage('Justificativa deve ter entre 15 e 255 caracteres'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { chaveNFe, cnpjDestinatario, justificativa, sequencia } = req.body;

        // Tentar envio real para SEFAZ
        if (ManifestacaoSefazService && global.dbPool) {
            try {
                const resultado = await ManifestacaoSefazService.enviarManifestacao(global.dbPool, {
                    chaveNFe,
                    tipoEvento: '210240',
                    justificativa,
                    userId: req.user?.id
                });
                return res.json({
                    success: resultado.sucesso,
                    evento: '210240',
                    descricao: EVENTOS_MANIFESTACAO['210240'].nome,
                    chaveNFe,
                    justificativa,
                    protocolo: resultado.protocolo,
                    codigoRetorno: resultado.codigoRetorno,
                    motivo: resultado.motivo,
                    alerta: '⚠️ ATENÇÃO: Este evento é IRREVERSÍVEL.',
                    integracaoSEFAZ: true
                });
            } catch (sefazError) {
                console.warn('[MD-e] Falha SEFAZ não-realizada, gerando local:', sefazError.message);
            }
        }

        // Fallback local
        const evento = gerarEventoManifestacao({
            chaveNFe,
            cnpjDestinatario,
            tipoEvento: '210240',
            sequencia: sequencia || 1,
            justificativa: justificativa
        });

        res.json({
            success: true,
            evento: '210240',
            descricao: EVENTOS_MANIFESTACAO['210240'].nome,
            chaveNFe: chaveNFe,
            justificativa: justificativa,
            xml: evento,
            status: 'GERADO',
            integracaoSEFAZ: false,
            alerta: '⚠️ ATENÇÃO: Este evento é IRREVERSÍVEL.',
            mensagem: 'Evento de Operação não Realizada gerado. A SEFAZ notificará o emitente.'
        });
    } catch (error) {
        console.error('Erro ao gerar operação não realizada:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar evento', error: error.message });
    }
});

/**
 * POST /consultar - Consulta NFes destinadas ao CNPJ
 * 
 * Busca NFes onde o CNPJ informado é o destinatário.
 */
router.post('/consultar', [
    body('cnpj').isLength({ min: 14, max: 14 }).withMessage('CNPJ deve ter 14 dígitos'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { cnpj, ultNSU, indNFe, indEmi } = req.body;

        // Tentar consulta real na SEFAZ via DistDFe
        if (ManifestacaoSefazService && global.dbPool) {
            try {
                const resultado = await ManifestacaoSefazService.consultarNFeDestinatario(global.dbPool, {
                    cnpj,
                    ultNSU: ultNSU || '0',
                    consNSU: req.body.NSU || null
                });
                return res.json({
                    success: true,
                    message: 'Consulta DistDFe realizada',
                    cnpj,
                    ultNSU: resultado.ultNSU,
                    maxNSU: resultado.maxNSU,
                    documentos: resultado.documentos || [],
                    totalDocumentos: (resultado.documentos || []).length,
                    integracaoSEFAZ: true
                });
            } catch (sefazError) {
                console.warn('[MD-e] Falha consulta SEFAZ:', sefazError.message);
            }
        }

        // Fallback: retorna instruções de consulta
        const consulta = {
            distDFeInt: {
                tpAmb: process.env.NFE_AMBIENTE || '2',
                cUFAutor: '35',
                CNPJ: cnpj,
                distNSU: ultNSU ? { ultNSU: ultNSU.toString().padStart(15, '0') } : null,
                consNSU: req.body.NSU ? { NSU: req.body.NSU.toString().padStart(15, '0') } : null
            }
        };

        res.json({
            success: true,
            message: 'Consulta de NFes destinadas (modo local)',
            cnpj: cnpj,
            consulta: consulta,
            integracaoSEFAZ: false,
            instrucoes: {
                webservice: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
                metodo: 'nfeDistDFeInteresse',
                documentacao: 'NT 2014.002 - Consulta da Relação de Documentos Destinados'
            },
            proximosPasso: [
                'Configure o certificado digital em ssl/',
                'A integração automática será ativada com certificado válido'
            ]
        });
    } catch (error) {
        console.error('Erro ao consultar NFes:', error);
        res.status(500).json({ success: false, message: 'Erro ao consultar', error: error.message });
    }
});

/**
 * GET /pendentes/:cnpj - Lista NFes pendentes de manifestação
 * 
 * Retorna NFes onde o destinatário ainda não registrou manifestação definitiva.
 */
router.get('/pendentes/:cnpj', async (req, res) => {
    try {
        const { cnpj } = req.params;

        // Buscar do banco de dados se disponível
        if (global.dbPool) {
            try {
                // Buscar NFs de entrada sem manifestação definitiva
                const [pendentes] = await global.dbPool.query(`
                    SELECT 
                        ne.id,
                        ne.chave_acesso,
                        ne.numero_nf,
                        ne.serie,
                        ne.emitente_cnpj,
                        ne.emitente_nome,
                        ne.valor_total,
                        ne.data_emissao,
                        ne.manifestacao_status,
                        me.tipo_evento as ultimo_evento,
                        me.data_evento as data_ultimo_evento
                    FROM nf_entrada ne
                    LEFT JOIN manifestacao_eventos me ON me.chave_nfe = ne.chave_acesso
                        AND me.data_evento = (
                            SELECT MAX(me2.data_evento) 
                            FROM manifestacao_eventos me2 
                            WHERE me2.chave_nfe = ne.chave_acesso
                        )
                    WHERE ne.emitente_cnpj != ?
                    AND (ne.manifestacao_status IS NULL 
                         OR ne.manifestacao_status IN ('PENDENTE', 'CIENCIA'))
                    ORDER BY ne.data_emissao DESC
                    LIMIT 100
                `, [cnpj]);

                return res.json({
                    success: true,
                    cnpj,
                    pendentes: pendentes,
                    total: pendentes.length,
                    dica: 'Execute POST /consultar periodicamente para buscar novas NFes da SEFAZ'
                });
            } catch (dbError) {
                console.warn('[MD-e] Erro DB pendentes:', dbError.message);
            }
        }

        res.json({
            success: true,
            cnpj: cnpj,
            pendentes: [],
            total: 0,
            message: 'Consulte /consultar para buscar NFes da SEFAZ',
            dica: 'Execute consultas periódicas (recomendado: a cada 1 hora) para manter a lista atualizada'
        });
    } catch (error) {
        console.error('Erro ao buscar pendentes:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar pendentes' });
    }
});

/**
 * GET /historico/:chave - Histórico de manifestações de uma NFe
 */
router.get('/historico/:chave', async (req, res) => {
    try {
        const { chave } = req.params;

        if (chave.length !== 44) {
            return res.status(400).json({ success: false, message: 'Chave NFe deve ter 44 dígitos' });
        }

        // Buscar histórico do banco de dados
        if (global.dbPool) {
            try {
                const [eventos] = await global.dbPool.query(`
                    SELECT 
                        tipo_evento,
                        CASE tipo_evento
                            WHEN '210210' THEN 'Ciência da Operação'
                            WHEN '210200' THEN 'Confirmação da Operação'
                            WHEN '210220' THEN 'Desconhecimento da Operação'
                            WHEN '210240' THEN 'Operação não Realizada'
                        END as descricao_evento,
                        protocolo_sefaz,
                        codigo_retorno,
                        motivo_retorno,
                        justificativa,
                        data_evento,
                        usuario_id
                    FROM manifestacao_eventos
                    WHERE chave_nfe = ?
                    ORDER BY data_evento ASC
                `, [chave]);

                const statusAtual = eventos.length > 0 
                    ? EVENTOS_MANIFESTACAO[eventos[eventos.length - 1].tipo_evento]?.nome || 'DESCONHECIDO'
                    : 'PENDENTE';

                return res.json({
                    success: true,
                    chaveNFe: chave,
                    eventos: eventos,
                    totalEventos: eventos.length,
                    statusAtual,
                    message: 'Histórico de manifestações da NFe'
                });
            } catch (dbError) {
                console.warn('[MD-e] Erro DB histórico:', dbError.message);
            }
        }

        res.json({
            success: true,
            chaveNFe: chave,
            eventos: [],
            statusAtual: 'PENDENTE',
            message: 'Histórico de manifestações da NFe (banco indisponível)'
        });
    } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar histórico' });
    }
});

// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================

/**
 * Gera estrutura do evento de manifestação
 */
function gerarEventoManifestacao({ chaveNFe, cnpjDestinatario, tipoEvento, sequencia, justificativa }) {
    const dataHora = new Date().toISOString();
    const idEvento = `ID${tipoEvento}${chaveNFe}${sequencia.toString().padStart(2, '0')}`;

    const evento = {
        evento: {
            versao: '1.00',
            infEvento: {
                Id: idEvento,
                cOrgao: '91', // Ambiente Nacional
                tpAmb: process.env.NFE_AMBIENTE || '2',
                CNPJ: cnpjDestinatario,
                chNFe: chaveNFe,
                dhEvento: dataHora,
                tpEvento: tipoEvento,
                nSeqEvento: sequencia,
                verEvento: '1.00',
                detEvento: {
                    versao: '1.00',
                    descEvento: EVENTOS_MANIFESTACAO[tipoEvento].nome,
                    xJust: justificativa // Apenas para 210240
                }
            }
        }
    };

    // Remove justificativa se não for necessária
    if (!justificativa) {
        delete evento.evento.infEvento.detEvento.xJust;
    }

    return evento;
}

/**
 * Valida chave de acesso da NFe
 */
function validarChaveNFe(chave) {
    if (!chave || chave.length !== 44) {
        return { valid: false, message: 'Chave deve ter 44 dígitos' };
    }

    // Extrai componentes da chave
    const componentes = {
        uf: chave.substring(0, 2),
        aamm: chave.substring(2, 6),
        cnpj: chave.substring(6, 20),
        modelo: chave.substring(20, 22),
        serie: chave.substring(22, 25),
        numero: chave.substring(25, 34),
        tipoEmissao: chave.substring(34, 35),
        codigoNumerico: chave.substring(35, 43),
        dv: chave.substring(43, 44)
    };

    // Valida dígito verificador
    const dvCalculado = calcularDVChaveNFe(chave.substring(0, 43));
    if (dvCalculado.toString() !== componentes.dv) {
        return { valid: false, message: 'Dígito verificador inválido' };
    }

    return {
        valid: true,
        componentes: componentes
    };
}

/**
 * Calcula dígito verificador da chave NFe
 */
function calcularDVChaveNFe(chave43) {
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;
    let pesoIndex = 0;

    for (let i = chave43.length - 1; i >= 0; i--) {
        soma += parseInt(chave43[i]) * pesos[pesoIndex];
        pesoIndex = (pesoIndex + 1) % 8;
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

// Exporta funções auxiliares para uso em outros módulos
router.validarChaveNFe = validarChaveNFe;
router.calcularDVChaveNFe = calcularDVChaveNFe;
router.EVENTOS_MANIFESTACAO = EVENTOS_MANIFESTACAO;
router.STATUS_MANIFESTACAO = STATUS_MANIFESTACAO;

module.exports = router;
