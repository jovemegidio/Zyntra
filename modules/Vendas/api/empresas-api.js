/**
 * API de Consulta de Empresas - Integração com Dados Públicos
 * Fontes: BrasilAPI (Receita Federal), Simples Nacional, CNPJ.ws
 */

const express = require('express');
const router = express.Router();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');

// Cache de empresas consultadas
const CACHE_FILE = path.join(__dirname, '../data/empresas-cache.json');
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas

// Garantir que o diretório data existe
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Carregar cache
function carregarCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Erro ao carregar cache:', e.message);
    }
    return { empresas: [], ultimaAtualizacao: null };
}

// Salvar cache
function salvarCache(dados) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(dados, null, 2), 'utf8');
    } catch (e) {
        console.log('Erro ao salvar cache:', e.message);
    }
}

// Formatar CNPJ
function formatarCNPJ(cnpj) {
    const numeros = cnpj.replace(/\D/g, '');
    return numeros.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Mapear porte da empresa
function mapearPorte(porte) {
    const map = {
        'MICRO EMPRESA': 'MEI/ME',
        'EMPRESA DE PEQUENO PORTE': 'EPP',
        'DEMAIS': 'Médio/Grande',
        'NAO INFORMADO': 'Não Informado'
    };
    return map[porte] || porte || 'Não Informado';
}

// Inferir segmento pela atividade CNAE
function inferirSegmento(cnaeDescricao) {
    if (!cnaeDescricao) return 'Outros';
    const desc = cnaeDescricao.toLowerCase();
    
    if (desc.includes('constru') || desc.includes('obra') || desc.includes('edificação') || desc.includes('incorpora')) return 'Construção Civil';
    if (desc.includes('indústria') || desc.includes('fabric') || desc.includes('metal') || desc.includes('alumínio') || desc.includes('siderur')) return 'Indústria';
    if (desc.includes('comércio') || desc.includes('venda') || desc.includes('loja') || desc.includes('varej')) return 'Comércio';
    if (desc.includes('agro') || desc.includes('rural') || desc.includes('agricultura') || desc.includes('pecuária')) return 'Agronegócio';
    if (desc.includes('imobiliári') || desc.includes('imóve')) return 'Imobiliário';
    if (desc.includes('transport') || desc.includes('logística')) return 'Transporte/Logística';
    if (desc.includes('tecnologia') || desc.includes('software') || desc.includes('informática')) return 'Tecnologia';
    return 'Serviços';
}

// ============ ROTAS ============

/**
 * Consulta empresa por CNPJ
 * GET /api/vendas/empresas/cnpj/:cnpj
 */
router.get('/cnpj/:cnpj', async (req, res) => {
    try {
        const cnpj = req.params.cnpj.replace(/\D/g, '');
        
        if (cnpj.length !== 14) {
            return res.status(400).json({ error: 'CNPJ inválido. Deve conter 14 dígitos.' });
        }

        // Verificar cache primeiro
        const cache = carregarCache();
        const empresaCacheada = cache.empresas.find(e => e.cnpj_numeros === cnpj);
        
        if (empresaCacheada && (Date.now() - new Date(empresaCacheada.data_consulta).getTime()) < CACHE_DURATION) {
            return res.json({ ...empresaCacheada, origem: 'cache' });
        }

        // Consultar APIs em sequência (fallback)
        let dadosEmpresa = null;

        // 1. Tentar BrasilAPI (Receita Federal)
        try {
            const brasilApiResponse = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
                timeout: 10000
            });
            
            if (brasilApiResponse.ok) {
                const dados = await brasilApiResponse.json();
                dadosEmpresa = transformarDadosBrasilAPI(dados, cnpj);
            }
        } catch (e) {
            console.log('BrasilAPI falhou, tentando alternativa...');
        }

        // 2. Tentar ReceitaWS como fallback
        if (!dadosEmpresa) {
            try {
                const receitaWsResponse = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
                    headers: { 'Accept': 'application/json' },
                    timeout: 10000
                });
                
                if (receitaWsResponse.ok) {
                    const dados = await receitaWsResponse.json();
                    if (dados.status !== 'ERROR') {
                        dadosEmpresa = transformarDadosReceitaWS(dados, cnpj);
                    }
                }
            } catch (e) {
                console.log('ReceitaWS falhou...');
            }
        }

        // 3. Tentar CNPJ.ws como último recurso
        if (!dadosEmpresa) {
            try {
                const cnpjWsResponse = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
                    timeout: 10000
                });
                
                if (cnpjWsResponse.ok) {
                    const dados = await cnpjWsResponse.json();
                    dadosEmpresa = transformarDadosCNPJWS(dados, cnpj);
                }
            } catch (e) {
                console.log('CNPJ.ws falhou...');
            }
        }

        if (!dadosEmpresa) {
            return res.status(404).json({ error: 'CNPJ não encontrado nas bases de dados públicas.' });
        }

        // Adicionar ao cache
        cache.empresas = cache.empresas.filter(e => e.cnpj_numeros !== cnpj);
        cache.empresas.push(dadosEmpresa);
        cache.ultimaAtualizacao = new Date().toISOString();
        salvarCache(cache);

        res.json({ ...dadosEmpresa, origem: 'api' });

    } catch (error) {
        console.error('Erro ao consultar CNPJ:', error);
        res.status(500).json({ error: 'Erro ao consultar empresa.' });
    }
});

/**
 * Buscar empresas por cidade/estado
 * GET /api/vendas/empresas/buscar?cidade=&uf=&segmento=&porte=
 */
router.get('/buscar', async (req, res) => {
    try {
        const { cidade, uf, segmento, porte, termo, pagina = 1, limite = 50 } = req.query;
        
        const cache = carregarCache();
        let resultados = cache.empresas;

        // Filtrar por termo (nome, cidade, etc)
        if (termo) {
            const termoLower = termo.toLowerCase();
            resultados = resultados.filter(e => 
                (e.razao_social || '').toLowerCase().includes(termoLower) ||
                (e.nome_fantasia || '').toLowerCase().includes(termoLower) ||
                (e.cidade || '').toLowerCase().includes(termoLower) ||
                (e.cnpj || '').includes(termoLower)
            );
        }

        // Filtrar por cidade
        if (cidade) {
            const cidadeLower = cidade.toLowerCase();
            resultados = resultados.filter(e => (e.cidade || '').toLowerCase().includes(cidadeLower));
        }

        // Filtrar por UF
        if (uf) {
            resultados = resultados.filter(e => (e.uf || '').toUpperCase() === uf.toUpperCase());
        }

        // Filtrar por segmento
        if (segmento) {
            const segmentoLower = segmento.toLowerCase();
            resultados = resultados.filter(e => (e.segmento || '').toLowerCase().includes(segmentoLower));
        }

        // Filtrar por porte
        if (porte) {
            resultados = resultados.filter(e => (e.porte || '').toLowerCase().includes(porte.toLowerCase()));
        }

        // Paginação
        const inicio = (parseInt(pagina) - 1) * parseInt(limite);
        const paginados = resultados.slice(inicio, inicio + parseInt(limite));

        res.json({
            total: resultados.length,
            pagina: parseInt(pagina),
            limite: parseInt(limite),
            empresas: paginados
        });

    } catch (error) {
        console.error('Erro ao buscar empresas:', error);
        res.status(500).json({ error: 'Erro ao buscar empresas.' });
    }
});

/**
 * Consultar Simples Nacional
 * GET /api/vendas/empresas/simples/:cnpj
 */
router.get('/simples/:cnpj', async (req, res) => {
    try {
        const cnpj = req.params.cnpj.replace(/\D/g, '');
        
        // Consultar BrasilAPI - endpoint do Simples Nacional
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
        
        if (!response.ok) {
            return res.status(404).json({ error: 'CNPJ não encontrado.' });
        }

        const dados = await response.json();

        res.json({
            cnpj: formatarCNPJ(cnpj),
            razao_social: dados.razao_social,
            optante_simples: dados.opcao_pelo_simples || false,
            data_opcao_simples: dados.data_opcao_simples,
            data_exclusao_simples: dados.data_exclusao_simples,
            optante_mei: dados.opcao_pelo_mei || false,
            data_opcao_mei: dados.data_opcao_mei,
            porte: mapearPorte(dados.porte),
            natureza_juridica: dados.natureza_juridica,
            situacao_cadastral: dados.descricao_situacao_cadastral
        });

    } catch (error) {
        console.error('Erro ao consultar Simples Nacional:', error);
        res.status(500).json({ error: 'Erro ao consultar Simples Nacional.' });
    }
});

/**
 * Listar empresas do cache (banco local)
 * GET /api/vendas/empresas
 */
router.get('/', (req, res) => {
    try {
        const cache = carregarCache();
        res.json({
            total: cache.empresas.length,
            ultimaAtualizacao: cache.ultimaAtualizacao,
            empresas: cache.empresas
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao listar empresas.' });
    }
});

/**
 * Estatísticas do banco de empresas
 * GET /api/vendas/empresas/stats
 */
router.get('/stats', (req, res) => {
    try {
        const cache = carregarCache();
        const empresas = cache.empresas;

        // Agrupar por UF
        const porUF = {};
        empresas.forEach(e => {
            const uf = e.uf || 'N/I';
            porUF[uf] = (porUF[uf] || 0) + 1;
        });

        // Agrupar por segmento
        const porSegmento = {};
        empresas.forEach(e => {
            const seg = e.segmento || 'Outros';
            porSegmento[seg] = (porSegmento[seg] || 0) + 1;
        });

        // Agrupar por porte
        const porPorte = {};
        empresas.forEach(e => {
            const porte = e.porte || 'N/I';
            porPorte[porte] = (porPorte[porte] || 0) + 1;
        });

        // Empresas ativas
        const ativas = empresas.filter(e => e.situacao === 'ATIVA').length;

        res.json({
            total: empresas.length,
            ativas,
            porUF,
            porSegmento,
            porPorte,
            ultimaAtualizacao: cache.ultimaAtualizacao
        });

    } catch (error) {
        res.status(500).json({ error: 'Erro ao gerar estatísticas.' });
    }
});

// ============ FUNÇÕES DE TRANSFORMAÇÃO ============

function transformarDadosBrasilAPI(dados, cnpj) {
    return {
        cnpj: formatarCNPJ(cnpj),
        cnpj_numeros: cnpj,
        razao_social: dados.razao_social,
        nome_fantasia: dados.nome_fantasia || dados.razao_social,
        
        // Endereço
        logradouro: dados.logradouro,
        numero: dados.numero,
        complemento: dados.complemento,
        bairro: dados.bairro,
        cidade: dados.municipio,
        uf: dados.uf,
        cep: dados.cep,
        endereco_completo: `${dados.logradouro}, ${dados.numero}${dados.complemento ? ' - ' + dados.complemento : ''} - ${dados.bairro}, ${dados.municipio}/${dados.uf}`,
        
        // Contato
        telefone: dados.ddd_telefone_1 ? `(${dados.ddd_telefone_1.substring(0,2)}) ${dados.ddd_telefone_1.substring(2)}` : '',
        telefone_2: dados.ddd_telefone_2 ? `(${dados.ddd_telefone_2.substring(0,2)}) ${dados.ddd_telefone_2.substring(2)}` : '',
        email: dados.email || '',
        
        // Classificação
        porte: mapearPorte(dados.porte),
        natureza_juridica: dados.natureza_juridica,
        cnae_principal: dados.cnae_fiscal,
        cnae_descricao: dados.cnae_fiscal_descricao,
        segmento: inferirSegmento(dados.cnae_fiscal_descricao),
        
        // Situação
        situacao: dados.descricao_situacao_cadastral,
        data_situacao: dados.data_situacao_cadastral,
        motivo_situacao: dados.descricao_motivo_situacao_cadastral,
        
        // Simples Nacional
        optante_simples: dados.opcao_pelo_simples || false,
        optante_mei: dados.opcao_pelo_mei || false,
        
        // Capital
        capital_social: dados.capital_social,
        capital_social_formatado: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dados.capital_social || 0),
        
        // Datas
        data_abertura: dados.data_inicio_atividade,
        data_consulta: new Date().toISOString(),
        
        // Sócios (se disponível)
        socios: dados.qsa?.map(s => ({
            nome: s.nome_socio,
            qualificacao: s.qualificacao_socio,
            data_entrada: s.data_entrada_sociedade
        })) || [],
        
        // CNAEs secundários
        cnaes_secundarios: dados.cnaes_secundarios?.map(c => ({
            codigo: c.codigo,
            descricao: c.descricao
        })) || [],
        
        // Metadados
        fonte: 'BrasilAPI',
        score_prospeccao: calcularScore(dados)
    };
}

function transformarDadosReceitaWS(dados, cnpj) {
    return {
        cnpj: formatarCNPJ(cnpj),
        cnpj_numeros: cnpj,
        razao_social: dados.nome,
        nome_fantasia: dados.fantasia || dados.nome,
        
        logradouro: dados.logradouro,
        numero: dados.numero,
        complemento: dados.complemento,
        bairro: dados.bairro,
        cidade: dados.municipio,
        uf: dados.uf,
        cep: dados.cep,
        endereco_completo: `${dados.logradouro}, ${dados.numero}${dados.complemento ? ' - ' + dados.complemento : ''} - ${dados.bairro}, ${dados.municipio}/${dados.uf}`,
        
        telefone: dados.telefone || '',
        email: dados.email || '',
        
        porte: dados.porte,
        natureza_juridica: dados.natureza_juridica,
        cnae_principal: dados.atividade_principal?.[0]?.code,
        cnae_descricao: dados.atividade_principal?.[0]?.text,
        segmento: inferirSegmento(dados.atividade_principal?.[0]?.text),
        
        situacao: dados.situacao,
        data_situacao: dados.data_situacao,
        
        capital_social: parseFloat(dados.capital_social?.replace(/\./g, '').replace(',', '.')) || 0,
        capital_social_formatado: dados.capital_social,
        
        data_abertura: dados.abertura,
        data_consulta: new Date().toISOString(),
        
        socios: dados.qsa?.map(s => ({
            nome: s.nome,
            qualificacao: s.qual
        })) || [],
        
        fonte: 'ReceitaWS',
        score_prospeccao: 50
    };
}

function transformarDadosCNPJWS(dados, cnpj) {
    const estabelecimento = dados.estabelecimento || {};
    
    return {
        cnpj: formatarCNPJ(cnpj),
        cnpj_numeros: cnpj,
        razao_social: dados.razao_social,
        nome_fantasia: estabelecimento.nome_fantasia || dados.razao_social,
        
        logradouro: estabelecimento.logradouro,
        numero: estabelecimento.numero,
        complemento: estabelecimento.complemento,
        bairro: estabelecimento.bairro,
        cidade: estabelecimento.cidade?.nome,
        uf: estabelecimento.estado?.sigla,
        cep: estabelecimento.cep,
        
        telefone: estabelecimento.telefone1 ? `(${estabelecimento.ddd1}) ${estabelecimento.telefone1}` : '',
        email: estabelecimento.email || '',
        
        porte: dados.porte?.descricao,
        natureza_juridica: dados.natureza_juridica?.descricao,
        cnae_principal: estabelecimento.atividade_principal?.id,
        cnae_descricao: estabelecimento.atividade_principal?.descricao,
        segmento: inferirSegmento(estabelecimento.atividade_principal?.descricao),
        
        situacao: estabelecimento.situacao_cadastral,
        data_situacao: estabelecimento.data_situacao_cadastral,
        
        capital_social: dados.capital_social,
        
        data_abertura: estabelecimento.data_inicio_atividade,
        data_consulta: new Date().toISOString(),
        
        socios: dados.socios?.map(s => ({
            nome: s.nome,
            qualificacao: s.qualificacao?.descricao
        })) || [],
        
        fonte: 'CNPJ.ws',
        score_prospeccao: 50
    };
}

// Calcular score de prospecção
function calcularScore(dados) {
    let score = 50; // Base

    // Empresa ativa +20
    if (dados.descricao_situacao_cadastral === 'ATIVA') score += 20;
    
    // Capital social alto +10
    if (dados.capital_social > 100000) score += 10;
    if (dados.capital_social > 1000000) score += 10;
    
    // Tem telefone +5
    if (dados.ddd_telefone_1) score += 5;
    
    // Tem email +5
    if (dados.email) score += 5;
    
    // Não é MEI +5
    if (!dados.opcao_pelo_mei) score += 5;
    
    // Empresa antiga (mais de 5 anos) +5
    const anoAbertura = parseInt(dados.data_inicio_atividade?.substring(0, 4));
    if (anoAbertura && (new Date().getFullYear() - anoAbertura) > 5) score += 5;

    return Math.min(score, 100);
}

module.exports = router;
