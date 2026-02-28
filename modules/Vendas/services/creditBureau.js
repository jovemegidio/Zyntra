/**
 * Serviço de Integração com Bureaus de Crédito
 * Suporta: Serasa, Boa Vista, SPC Brasil, Quod
 * 
 * ALUFORCE - Sistema de Gestão
 * Versão: 1.0.0
 * Data: Janeiro 2026
 */

const axios = require('axios');
const crypto = require('crypto');

// ========================================
// CONFIGURAÇÕES DOS BUREAUS
// ========================================
const BUREAU_CONFIG = {
    // Serasa Experian
    serasa: {
        name: 'Serasa Experian',
        baseUrl: process.env.SERASA_API_URL || 'https://api.serasaexperian.com.br',
        clientId: process.env.SERASA_CLIENT_ID || '',
        clientSecret: process.env.SERASA_CLIENT_SECRET || '',
        enabled: false, // Ativar quando tiver credenciais
        endpoints: {
            auth: '/oauth/token',
            consultaCPF: '/credit/v1/consulta/cpf',
            consultaCNPJ: '/credit/v1/consulta/cnpj',
            score: '/score/v1/consulta'
        }
    },
    
    // Boa Vista SCPC
    boavista: {
        name: 'Boa Vista SCPC',
        baseUrl: process.env.BOAVISTA_API_URL || 'https://api.boavistaservicos.com.br',
        apiKey: process.env.BOAVISTA_API_KEY || '',
        apiSecret: process.env.BOAVISTA_API_SECRET || '',
        enabled: false, // Ativar quando tiver credenciais
        endpoints: {
            consultaCPF: '/v1/consulta/pessoa-fisica',
            consultaCNPJ: '/v1/consulta/pessoa-juridica',
            score: '/v1/score'
        }
    },
    
    // SPC Brasil
    spc: {
        name: 'SPC Brasil',
        baseUrl: process.env.SPC_API_URL || 'https://api.spcbrasil.org.br',
        usuario: process.env.SPC_USUARIO || '',
        senha: process.env.SPC_SENHA || '',
        enabled: false, // Ativar quando tiver credenciais
        endpoints: {
            consultaCPF: '/consulta/cpf',
            consultaCNPJ: '/consulta/cnpj'
        }
    },
    
    // Quod
    quod: {
        name: 'Quod',
        baseUrl: process.env.QUOD_API_URL || 'https://api.quod.com.br',
        clientId: process.env.QUOD_CLIENT_ID || '',
        clientSecret: process.env.QUOD_CLIENT_SECRET || '',
        enabled: false, // Ativar quando tiver credenciais
        endpoints: {
            auth: '/oauth2/token',
            consultaCPF: '/v1/pessoa-fisica/score',
            consultaCNPJ: '/v1/pessoa-juridica/score'
        }
    }
};

// Cache para tokens de autenticação
const tokenCache = {};

// ========================================
// FUNÇÕES DE AUTENTICAÇÃO
// ========================================

/**
 * Obtém token de autenticação do Serasa
 */
async function getSerasaToken() {
    const config = BUREAU_CONFIG.serasa;
    
    // Verificar cache
    if (tokenCache.serasa && tokenCache.serasa.expiry > Date.now()) {
        return tokenCache.serasa.token;
    }
    
    try {
        const response = await axios.post(`${config.baseUrl}${config.endpoints.auth}`, {
            grant_type: 'client_credentials',
            client_id: config.clientId,
            client_secret: config.clientSecret
        }, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        // Armazenar no cache
        tokenCache.serasa = {
            token: response.data.access_token,
            expiry: Date.now() + (response.data.expires_in * 1000) - 60000 // 1 min antes
        };
        
        return tokenCache.serasa.token;
    } catch (error) {
        console.error('Erro ao obter token Serasa:', error.message);
        throw new Error('Falha na autenticação Serasa');
    }
}

/**
 * Obtém token de autenticação do Quod
 */
async function getQuodToken() {
    const config = BUREAU_CONFIG.quod;
    
    if (tokenCache.quod && tokenCache.quod.expiry > Date.now()) {
        return tokenCache.quod.token;
    }
    
    try {
        const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
        
        const response = await axios.post(`${config.baseUrl}${config.endpoints.auth}`, 
            'grant_type=client_credentials',
            {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        tokenCache.quod = {
            token: response.data.access_token,
            expiry: Date.now() + (response.data.expires_in * 1000) - 60000
        };
        
        return tokenCache.quod.token;
    } catch (error) {
        console.error('Erro ao obter token Quod:', error.message);
        throw new Error('Falha na autenticação Quod');
    }
}

// ========================================
// FUNÇÕES DE CONSULTA
// ========================================

/**
 * Consulta crédito no Serasa
 * @param {string} documento - CPF ou CNPJ
 * @returns {Object} Dados de crédito
 */
async function consultarSerasa(documento) {
    const config = BUREAU_CONFIG.serasa;
    
    if (!config.enabled) {
        throw new Error('Integração Serasa não configurada');
    }
    
    const token = await getSerasaToken();
    const isCNPJ = documento.replace(/\D/g, '').length > 11;
    const endpoint = isCNPJ ? config.endpoints.consultaCNPJ : config.endpoints.consultaCPF;
    
    try {
        const response = await axios.get(`${config.baseUrl}${endpoint}/${documento.replace(/\D/g, '')}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        return formatarRespostaSerasa(response.data);
    } catch (error) {
        console.error('Erro consulta Serasa:', error.message);
        throw new Error('Falha na consulta Serasa');
    }
}

/**
 * Consulta crédito na Boa Vista
 * @param {string} documento - CPF ou CNPJ
 * @returns {Object} Dados de crédito
 */
async function consultarBoaVista(documento) {
    const config = BUREAU_CONFIG.boavista;
    
    if (!config.enabled) {
        throw new Error('Integração Boa Vista não configurada');
    }
    
    const isCNPJ = documento.replace(/\D/g, '').length > 11;
    const endpoint = isCNPJ ? config.endpoints.consultaCNPJ : config.endpoints.consultaCPF;
    
    // Gerar assinatura HMAC
    const timestamp = Date.now();
    const message = `${config.apiKey}${timestamp}`;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(message).digest('hex');
    
    try {
        const response = await axios.get(`${config.baseUrl}${endpoint}`, {
            params: { documento: documento.replace(/\D/g, '') },
            headers: {
                'X-Api-Key': config.apiKey,
                'X-Timestamp': timestamp,
                'X-Signature': signature,
                'Content-Type': 'application/json'
            }
        });
        
        return formatarRespostaBoaVista(response.data);
    } catch (error) {
        console.error('Erro consulta Boa Vista:', error.message);
        throw new Error('Falha na consulta Boa Vista');
    }
}

/**
 * Consulta crédito no SPC Brasil
 * @param {string} documento - CPF ou CNPJ
 * @returns {Object} Dados de crédito
 */
async function consultarSPC(documento) {
    const config = BUREAU_CONFIG.spc;
    
    if (!config.enabled) {
        throw new Error('Integração SPC não configurada');
    }
    
    const isCNPJ = documento.replace(/\D/g, '').length > 11;
    const endpoint = isCNPJ ? config.endpoints.consultaCNPJ : config.endpoints.consultaCPF;
    
    try {
        const credentials = Buffer.from(`${config.usuario}:${config.senha}`).toString('base64');
        
        const response = await axios.get(`${config.baseUrl}${endpoint}/${documento.replace(/\D/g, '')}`, {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            }
        });
        
        return formatarRespostaSPC(response.data);
    } catch (error) {
        console.error('Erro consulta SPC:', error.message);
        throw new Error('Falha na consulta SPC');
    }
}

/**
 * Consulta crédito no Quod
 * @param {string} documento - CPF ou CNPJ
 * @returns {Object} Dados de crédito
 */
async function consultarQuod(documento) {
    const config = BUREAU_CONFIG.quod;
    
    if (!config.enabled) {
        throw new Error('Integração Quod não configurada');
    }
    
    const token = await getQuodToken();
    const isCNPJ = documento.replace(/\D/g, '').length > 11;
    const endpoint = isCNPJ ? config.endpoints.consultaCNPJ : config.endpoints.consultaCPF;
    
    try {
        const response = await axios.post(`${config.baseUrl}${endpoint}`, {
            documento: documento.replace(/\D/g, '')
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        return formatarRespostaQuod(response.data);
    } catch (error) {
        console.error('Erro consulta Quod:', error.message);
        throw new Error('Falha na consulta Quod');
    }
}

// ========================================
// FORMATADORES DE RESPOSTA
// ========================================

function formatarRespostaSerasa(data) {
    return {
        bureau: 'Serasa Experian',
        score: data.score || data.scoreCredito || null,
        scoreRange: { min: 0, max: 1000 },
        classificacao: classificarScore(data.score, 'serasa'),
        restricoes: {
            total: data.restricoes?.quantidade || 0,
            valor: data.restricoes?.valorTotal || 0,
            detalhes: data.restricoes?.lista || []
        },
        protestos: {
            total: data.protestos?.quantidade || 0,
            valor: data.protestos?.valorTotal || 0
        },
        cheques: {
            total: data.chequesSemFundo?.quantidade || 0,
            valor: data.chequesSemFundo?.valorTotal || 0
        },
        acoes: {
            total: data.acoesJudiciais?.quantidade || 0
        },
        consultasRecentes: data.consultasRecentes || 0,
        dataConsulta: new Date().toISOString(),
        raw: data
    };
}

function formatarRespostaBoaVista(data) {
    return {
        bureau: 'Boa Vista SCPC',
        score: data.score || data.pontuacao || null,
        scoreRange: { min: 0, max: 1000 },
        classificacao: classificarScore(data.score, 'boavista'),
        restricoes: {
            total: data.pendencias?.quantidade || 0,
            valor: data.pendencias?.valorTotal || 0,
            detalhes: data.pendencias?.itens || []
        },
        protestos: {
            total: data.protestos?.quantidade || 0,
            valor: data.protestos?.valorTotal || 0
        },
        cheques: {
            total: data.cheques?.quantidade || 0,
            valor: data.cheques?.valorTotal || 0
        },
        participacaoEmpresas: data.participacaoEmpresas || [],
        dataConsulta: new Date().toISOString(),
        raw: data
    };
}

function formatarRespostaSPC(data) {
    return {
        bureau: 'SPC Brasil',
        score: data.score || null,
        scoreRange: { min: 0, max: 1000 },
        classificacao: classificarScore(data.score, 'spc'),
        restricoes: {
            total: data.spc?.quantidade || 0,
            valor: data.spc?.valorTotal || 0,
            detalhes: data.spc?.registros || []
        },
        protestos: {
            total: data.protesto?.quantidade || 0,
            valor: data.protesto?.valorTotal || 0
        },
        cheques: {
            total: data.ccf?.quantidade || 0,
            valor: data.ccf?.valorTotal || 0
        },
        dataConsulta: new Date().toISOString(),
        raw: data
    };
}

function formatarRespostaQuod(data) {
    return {
        bureau: 'Quod',
        score: data.score || data.pontuacao || null,
        scoreRange: { min: 0, max: 1000 },
        classificacao: classificarScore(data.score, 'quod'),
        restricoes: {
            total: data.negativacoes?.quantidade || 0,
            valor: data.negativacoes?.valorTotal || 0,
            detalhes: data.negativacoes?.lista || []
        },
        cadastroPositivo: {
            disponivel: data.cadastroPositivo?.disponivel || false,
            indicadores: data.cadastroPositivo?.indicadores || {}
        },
        dataConsulta: new Date().toISOString(),
        raw: data
    };
}

/**
 * Classifica o score em faixas
 */
function classificarScore(score, bureau = 'serasa') {
    if (!score) return { faixa: 'Indisponível', cor: '#6b7280', risco: 'desconhecido' };
    
    // Faixas padrão (maioria dos bureaus usa 0-1000)
    if (score >= 800) {
        return { faixa: 'Excelente', cor: '#22c55e', risco: 'muito baixo' };
    } else if (score >= 600) {
        return { faixa: 'Bom', cor: '#84cc16', risco: 'baixo' };
    } else if (score >= 400) {
        return { faixa: 'Regular', cor: '#eab308', risco: 'médio' };
    } else if (score >= 200) {
        return { faixa: 'Ruim', cor: '#f97316', risco: 'alto' };
    } else {
        return { faixa: 'Muito Ruim', cor: '#ef4444', risco: 'muito alto' };
    }
}

// ========================================
// FUNÇÃO PRINCIPAL DE CONSULTA
// ========================================

/**
 * Consulta crédito no bureau configurado
 * @param {string} documento - CPF ou CNPJ
 * @param {string} bureauPreferido - 'serasa', 'boavista', 'spc', 'quod' ou 'auto'
 * @returns {Object} Dados de crédito padronizados
 */
async function consultarCredito(documento, bureauPreferido = 'auto') {
    // Validar documento
    const docLimpo = documento.replace(/\D/g, '');
    if (docLimpo.length !== 11 && docLimpo.length !== 14) {
        throw new Error('Documento inválido. Informe CPF (11 dígitos) ou CNPJ (14 dígitos)');
    }
    
    // Se preferência específica
    if (bureauPreferido !== 'auto') {
        const bureauFn = {
            serasa: consultarSerasa,
            boavista: consultarBoaVista,
            spc: consultarSPC,
            quod: consultarQuod
        }[bureauPreferido];
        
        if (!bureauFn) {
            throw new Error(`Bureau '${bureauPreferido}' não reconhecido`);
        }
        
        return await bureauFn(documento);
    }
    
    // Modo auto: tentar bureaus na ordem de prioridade
    const prioridade = ['boavista', 'serasa', 'quod', 'spc'];
    
    for (const bureau of prioridade) {
        if (BUREAU_CONFIG[bureau].enabled) {
            try {
                const bureauFn = {
                    serasa: consultarSerasa,
                    boavista: consultarBoaVista,
                    spc: consultarSPC,
                    quod: consultarQuod
                }[bureau];
                
                return await bureauFn(documento);
            } catch (error) {
                console.warn(`Falha no bureau ${bureau}:`, error.message);
                continue; // Tentar próximo bureau
            }
        }
    }
    
    // Nenhum bureau habilitado - retornar dados simulados para desenvolvimento
    console.warn('Nenhum bureau de crédito configurado. Retornando dados simulados.');
    return getDadosSimulados(documento);
}

/**
 * Retorna dados simulados para desenvolvimento/teste
 */
function getDadosSimulados(documento) {
    const docLimpo = documento.replace(/\D/g, '');
    const isCNPJ = docLimpo.length === 14;
    
    // Gerar score baseado no documento (para ter consistência nos testes)
    const hash = docLimpo.split('').reduce((a, b) => a + parseInt(b), 0);
    const scoreBase = (hash % 600) + 300; // Score entre 300 e 900
    
    return {
        bureau: 'Sistema Interno (Simulado)',
        simulado: true,
        mensagem: 'Dados simulados - Configure credenciais do bureau para dados reais',
        score: scoreBase,
        scoreRange: { min: 0, max: 1000 },
        classificacao: classificarScore(scoreBase),
        restricoes: {
            total: scoreBase < 500 ? Math.floor(Math.random() * 3) : 0,
            valor: scoreBase < 500 ? Math.floor(Math.random() * 5000) : 0,
            detalhes: []
        },
        protestos: {
            total: scoreBase < 400 ? Math.floor(Math.random() * 2) : 0,
            valor: scoreBase < 400 ? Math.floor(Math.random() * 3000) : 0
        },
        cheques: {
            total: 0,
            valor: 0
        },
        consultasRecentes: Math.floor(Math.random() * 5),
        dataConsulta: new Date().toISOString(),
        documento: {
            tipo: isCNPJ ? 'CNPJ' : 'CPF',
            numero: docLimpo
        }
    };
}

/**
 * Verifica status das integrações
 */
function getStatusIntegracoes() {
    return {
        serasa: {
            nome: BUREAU_CONFIG.serasa.name,
            habilitado: BUREAU_CONFIG.serasa.enabled,
            configurado: !!BUREAU_CONFIG.serasa.clientId
        },
        boavista: {
            nome: BUREAU_CONFIG.boavista.name,
            habilitado: BUREAU_CONFIG.boavista.enabled,
            configurado: !!BUREAU_CONFIG.boavista.apiKey
        },
        spc: {
            nome: BUREAU_CONFIG.spc.name,
            habilitado: BUREAU_CONFIG.spc.enabled,
            configurado: !!BUREAU_CONFIG.spc.usuario
        },
        quod: {
            nome: BUREAU_CONFIG.quod.name,
            habilitado: BUREAU_CONFIG.quod.enabled,
            configurado: !!BUREAU_CONFIG.quod.clientId
        }
    };
}

/**
 * Habilita/desabilita um bureau
 */
function configurarBureau(bureau, config) {
    if (!BUREAU_CONFIG[bureau]) {
        throw new Error(`Bureau '${bureau}' não encontrado`);
    }
    
    Object.assign(BUREAU_CONFIG[bureau], config);
    
    // Se passou credenciais, habilitar automaticamente
    if (config.clientId || config.apiKey || config.usuario) {
        BUREAU_CONFIG[bureau].enabled = true;
    }
    
    return BUREAU_CONFIG[bureau];
}

module.exports = {
    consultarCredito,
    consultarSerasa,
    consultarBoaVista,
    consultarSPC,
    consultarQuod,
    getStatusIntegracoes,
    configurarBureau,
    getDadosSimulados,
    classificarScore,
    BUREAU_CONFIG
};
