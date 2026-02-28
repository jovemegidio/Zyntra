/**
 * SERVIÇO DE CONFIGURAÇÕES DA EMPRESA
 * Centraliza a busca dos dados da empresa para uso em PDFs, relatórios e documentos
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2026-01-19
 */

const path = require('path');
const fs = require('fs');

/**
 * Dados padrão da empresa (fallback)
 */
const DADOS_EMPRESA_PADRAO = {
    razao_social: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
    nome_fantasia: 'ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES ELETRICOS',
    cnpj: '68.192.475/0001-60',
    inscricao_estadual: '103.385.861-110',
    inscricao_municipal: '',
    telefone: '(11) 94723-8729',
    email: '',
    site: '',
    cep: '08537-400',
    estado: 'SP',
    cidade: 'Ferraz de Vasconcelos',
    bairro: 'VILA SÍO JOÍO',
    endereco: 'RUA ERNESTINA',
    numero: '270',
    complemento: '',
    logo_url: null,
    favicon_url: null,
    // Campos fiscais Fase 1
    regime_tributario: 'simples',
    crt: 1,
    codigo_municipio: '3515707',  // Ferraz de Vasconcelos - IBGE
    codigo_uf: '35',              // SP
    cnae: '',
    suframa: null,
    nfe_ambiente: 2,              // Homologação
    nfe_serie: 1,
    nfe_proximo_numero: 1
};

/**
 * Busca as configurações da empresa no banco de dados
 * @param {Object} pool - Pool de conexão MySQL
 * @returns {Promise<Object>} Dados da empresa
 */
async function buscarConfiguracoesEmpresa(pool) {
    try {
        const [rows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
        
        if (rows.length > 0) {
            return {
                ...DADOS_EMPRESA_PADRAO,
                ...rows[0]
            };
        }
        
        return DADOS_EMPRESA_PADRAO;
    } catch (error) {
        console.error('[EmpresaConfig] Erro ao buscar configurações:', error.message);
        return DADOS_EMPRESA_PADRAO;
    }
}

/**
 * Resolve o caminho absoluto da logo da empresa
 * @param {Object} config - Configurações da empresa
 * @param {string} baseDir - Diretório base (geralmente public)
 * @returns {string|null} Caminho absoluto da logo ou null
 */
function resolverCaminhoLogo(config, baseDir = null) {
    const basePath = baseDir || path.join(__dirname, '..', '..', '..', 'public');
    
    // 1. Tentar logo das configurações
    if (config.logo_url) {
        const logoPath = path.join(basePath, config.logo_url.replace(/^\//, ''));
        if (fs.existsSync(logoPath)) {
            return logoPath;
        }
    }
    
    // 2. Fallback para logo padrão
    const logoPadrao = path.join(basePath, 'images', 'Logo Monocromatico - Azul - Aluforce.png');
    if (fs.existsSync(logoPadrao)) {
        return logoPadrao;
    }
    
    // 3. Tentar outras variações do nome
    const variacoes = [
        'images/logo-aluforce.png',
        'images/logo.png',
        'img/logo.png'
    ];
    
    for (const variacao of variacoes) {
        const caminhoVariacao = path.join(basePath, variacao);
        if (fs.existsSync(caminhoVariacao)) {
            return caminhoVariacao;
        }
    }
    
    return null;
}

/**
 * Formata os dados da empresa para uso em PDFs
 * @param {Object} config - Configurações da empresa
 * @returns {Object} Dados formatados para PDF
 */
function formatarDadosParaPDF(config) {
    return {
        nome: config.razao_social || DADOS_EMPRESA_PADRAO.razao_social,
        nomeFantasia: config.nome_fantasia || DADOS_EMPRESA_PADRAO.nome_fantasia,
        cnpj: config.cnpj || DADOS_EMPRESA_PADRAO.cnpj,
        inscricaoEstadual: config.inscricao_estadual || 'Isento',
        inscricaoMunicipal: config.inscricao_municipal || '',
        telefone: config.telefone || DADOS_EMPRESA_PADRAO.telefone,
        email: config.email || '',
        site: config.site || '',
        enderecoCompleto: formatarEndereco(config),
        endereco: config.endereco || DADOS_EMPRESA_PADRAO.endereco,
        numero: config.numero || DADOS_EMPRESA_PADRAO.numero,
        complemento: config.complemento || '',
        bairro: config.bairro || DADOS_EMPRESA_PADRAO.bairro,
        cidade: config.cidade || DADOS_EMPRESA_PADRAO.cidade,
        estado: config.estado || DADOS_EMPRESA_PADRAO.estado,
        cep: config.cep || DADOS_EMPRESA_PADRAO.cep,
        logoUrl: config.logo_url,
        faviconUrl: config.favicon_url
    };
}

/**
 * Formata o endereço completo da empresa
 * @param {Object} config - Configurações da empresa
 * @returns {string} Endereço formatado
 */
function formatarEndereco(config) {
    const partes = [];
    
    if (config.endereco) partes.push(config.endereco);
    if (config.numero) partes.push(config.numero);
    if (config.complemento) partes.push(config.complemento);
    
    let linha1 = partes.join(', ');
    
    const partes2 = [];
    if (config.bairro) partes2.push(config.bairro);
    if (config.cidade) partes2.push(config.cidade);
    if (config.estado) partes2.push(config.estado);
    
    let linha2 = partes2.join(' - ');
    
    if (config.cep) {
        linha2 += ` | CEP: ${config.cep}`;
    }
    
    return linha1 + (linha2 ? ` | ${linha2}` : '');
}

/**
 * Desenha o cabeçalho padrão em um documento PDF
 * @param {Object} doc - Documento PDFKit
 * @param {Object} config - Configurações da empresa
 * @param {Object} options - Opções de renderização
 */
function desenharCabecalhoPDF(doc, config, options = {}) {
    const {
        y = 30,
        larguraLogo = 120,
        corPrimaria = '#1e293b',
        corSecundaria = '#666666'
    } = options;
    
    const basePath = options.basePath || path.join(__dirname, '..', '..', '..', 'public');
    const logoPath = resolverCaminhoLogo(config, basePath);
    
    // Logo
    if (logoPath) {
        try {
            doc.image(logoPath, 40, y, { width: larguraLogo });
        } catch (e) {
            console.log('[PDF] Erro ao carregar logo:', e.message);
        }
    }
    
    // Dados da empresa (lado direito)
    const dados = formatarDadosParaPDF(config);
    
    doc.fontSize(10)
       .fillColor(corPrimaria)
       .text(dados.nome, 350, y + 5, { align: 'right' })
       .fontSize(8)
       .fillColor(corSecundaria)
       .text(`CNPJ: ${dados.cnpj}`, 350, y + 20, { align: 'right' });
    
    if (dados.inscricaoEstadual) {
        doc.text(`IE: ${dados.inscricaoEstadual}`, 350, y + 32, { align: 'right' });
    }
    
    doc.text(`${dados.endereco}, ${dados.numero}`, 350, y + 44, { align: 'right' })
       .text(`${dados.bairro} - ${dados.cidade}/${dados.estado}`, 350, y + 56, { align: 'right' });
    
    if (dados.telefone) {
        doc.text(`Tel: ${dados.telefone}`, 350, y + 68, { align: 'right' });
    }
    
    return y + 90; // Retorna posição Y após o cabeçalho
}

module.exports = {
    DADOS_EMPRESA_PADRAO,
    buscarConfiguracoesEmpresa,
    resolverCaminhoLogo,
    formatarDadosParaPDF,
    formatarEndereco,
    desenharCabecalhoPDF
};
