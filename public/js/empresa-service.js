/**
 * EMPRESA SERVICE - ALUFORCE
 * Serviço centralizado para buscar e cachear dados da empresa
 * Usado para templates de impressão, relatórios e documentos
 */

const EmpresaService = {
    // Cache dos dados da empresa
    _cache: null,
    _cacheTime: null,
    _cacheExpiry: 5 * 60 * 1000, // 5 minutos em milissegundos

    // Dados padrão para fallback
    DADOS_PADRAO: {
        razao_social: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
        nome_fantasia: 'ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES ELETRICOS',
        cnpj: '68.192.475/0001-60',
        inscricao_estadual: '',
        telefone: '(11) 91793-9089',
        email: '',
        site: '',
        cep: '08537-400',
        estado: 'SP',
        cidade: 'Ferraz de Vasconcelos',
        bairro: 'VILA SÍO JOÍO',
        endereco: 'RUA ERNESTINA',
        numero: '270',
        complemento: '',
        logo_url: '/public/images/Logo Monocromatico - Azul - Aluforce.png'
    },

    /**
     * Busca dados da empresa da API (com cache)
     * @returns {Promise<Object>} Dados da empresa
     */
    async getDados() {
        try {
            // Verifica cache válido
            if (this._cache && this._cacheTime) {
                const agora = Date.now();
                if (agora - this._cacheTime < this._cacheExpiry) {
                    return this._cache;
                }
            }

            // Busca da API
            const response = await fetch('/api/configuracoes/empresa', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                const dados = await response.json();
                // Merge com dados padrão para garantir campos
                this._cache = { ...this.DADOS_PADRAO, ...dados };
                this._cacheTime = Date.now();
                console.log('[EmpresaService] Dados carregados com sucesso');
                return this._cache;
            }

            // Se falhou, tenta buscar do endpoint alternativo
            const altResponse = await fetch('/api/empresa-config', {
                method: 'GET',
                credentials: 'include'
            });

            if (altResponse.ok) {
                const dados = await altResponse.json();
                this._cache = { ...this.DADOS_PADRAO, ...dados };
                this._cacheTime = Date.now();
                console.log('[EmpresaService] Dados carregados via endpoint alternativo');
                return this._cache;
            }

            // Fallback para dados padrão
            console.warn('[EmpresaService] Usando dados padrão (API indisponível)');
            return this.DADOS_PADRAO;

        } catch (error) {
            console.error('[EmpresaService] Erro ao buscar dados:', error);
            return this.DADOS_PADRAO;
        }
    },

    /**
     * Limpa o cache para forçar nova busca
     */
    limparCache() {
        this._cache = null;
        this._cacheTime = null;
        console.log('[EmpresaService] Cache limpo');
    },

    /**
     * Retorna URL da logo (com fallback)
     * @returns {Promise<string>} URL da logo
     */
    async getLogoUrl() {
        const dados = await this.getDados();
        return dados.logo_url || this.DADOS_PADRAO.logo_url;
    },

    /**
     * Retorna o nome fantasia ou razão social
     * @returns {Promise<string>} Nome da empresa
     */
    async getNomeEmpresa() {
        const dados = await this.getDados();
        return dados.nome_fantasia || dados.razao_social || 'ALUFORCE';
    },

    /**
     * Retorna endereço completo formatado
     * @returns {Promise<string>} Endereço completo
     */
    async getEnderecoCompleto() {
        const dados = await this.getDados();
        const partes = [];
        
        if (dados.endereco) partes.push(dados.endereco);
        if (dados.numero) partes.push(dados.numero);
        if (dados.complemento) partes.push(dados.complemento);
        if (dados.bairro) partes.push(dados.bairro);
        if (dados.cidade && dados.estado) {
            partes.push(`${dados.cidade} - ${dados.estado}`);
        }
        if (dados.cep) partes.push(`CEP: ${dados.cep}`);
        
        return partes.join(', ');
    },

    /**
     * Formata CNPJ para exibição
     * @param {string} cnpj - CNPJ sem formatação
     * @returns {string} CNPJ formatado
     */
    formatarCnpj(cnpj) {
        if (!cnpj) return '';
        // Remove caracteres não numéricos
        const numeros = cnpj.replace(/\D/g, '');
        if (numeros.length !== 14) return cnpj;
        // Aplica máscara
        return numeros.replace(
            /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
            '$1.$2.$3/$4-$5'
        );
    },

    /**
     * Gera HTML do cabeçalho para impressão
     * @param {Object} options - Opções do cabeçalho
     * @param {string} options.titulo - Título do documento (ex: "PEDIDO DE VENDA")
     * @param {string} options.numero - Número do documento
     * @param {boolean} options.incluirLogo - Se deve incluir logo (default: true)
     * @param {boolean} options.incluirEndereco - Se deve incluir endereço (default: true)
     * @returns {Promise<string>} HTML do cabeçalho
     */
    async gerarCabecalhoHTML(options = {}) {
        const dados = await this.getDados();
        const {
            titulo = '',
            numero = '',
            incluirLogo = true,
            incluirEndereco = true
        } = options;

        const logoUrl = dados.logo_url || this.DADOS_PADRAO.logo_url;
        const nomeEmpresa = dados.nome_fantasia || dados.razao_social || 'ALUFORCE';
        const cnpjFormatado = this.formatarCnpj(dados.cnpj);

        let html = `
            <div class="header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #1a365d; padding-bottom: 15px;">
                ${incluirLogo ? `
                <div class="logo" style="flex: 0 0 150px;">
                    <img src="${logoUrl}" alt="${nomeEmpresa}" style="max-width: 150px; max-height: 60px;" onerror="this.style.display='none'">
                </div>
                ` : ''}
                <div class="empresa-info" style="flex: 1; ${incluirLogo ? 'margin-left: 20px;' : ''} text-align: ${incluirLogo ? 'left' : 'center'};">
                    <h1 style="font-size: 16px; color: #1a365d; margin: 0 0 5px 0;">${nomeEmpresa}</h1>
                    ${cnpjFormatado ? `<p style="font-size: 11px; margin: 2px 0;">CNPJ: ${cnpjFormatado}</p>` : ''}
                    ${incluirEndereco ? `
                    <p style="font-size: 10px; color: #4a5568; margin: 2px 0;">
                        ${[dados.endereco, dados.numero].filter(Boolean).join(', ')}
                        ${dados.bairro ? ` - ${dados.bairro}` : ''}
                    </p>
                    <p style="font-size: 10px; color: #4a5568; margin: 2px 0;">
                        ${dados.cidade || ''} - ${dados.estado || ''} | CEP: ${dados.cep || ''}
                    </p>
                    ` : ''}
                    ${dados.telefone ? `<p style="font-size: 10px; color: #4a5568; margin: 2px 0;">Tel: ${dados.telefone}</p>` : ''}
                </div>
                ${titulo ? `
                <div class="documento-info" style="text-align: right;">
                    <h2 style="font-size: 14px; color: #1a365d; margin: 0;">${titulo}</h2>
                    ${numero ? `<p style="font-size: 18px; font-weight: bold; margin: 5px 0;">Nº ${numero}</p>` : ''}
                </div>
                ` : ''}
            </div>
        `;

        return html;
    },

    /**
     * Gera HTML do rodapé para impressão
     * @returns {Promise<string>} HTML do rodapé
     */
    async gerarRodapeHTML() {
        const dados = await this.getDados();
        const nomeEmpresa = dados.nome_fantasia || dados.razao_social || 'ALUFORCE';
        
        return `
            <div class="footer" style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #718096;">
                <p>Documento gerado em ${new Date().toLocaleString('pt-BR')}</p>
                <p>${nomeEmpresa} - Sistema de Gestão Empresarial</p>
            </div>
        `;
    }
};

// Exportar para uso global
window.EmpresaService = EmpresaService;

// Auto-inicialização para pré-carregar dados quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    // Pré-carrega dados em background (não bloqueia)
    EmpresaService.getDados().catch(() => {});
});

console.log('[EmpresaService] Serviço de dados da empresa carregado');
