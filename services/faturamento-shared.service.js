/**
 * SERVIÇO COMPARTILHADO DE FATURAMENTO
 * Centraliza lógica comum entre os 3 fluxos de faturamento:
 *   1. Enterprise (faturamento.js)
 *   2. Vendas Parcial/Remessa (vendas-routes.js)
 *   3. Legacy NF-e (nfe-routes.js)
 * 
 * @module services/faturamento-shared
 * @version 1.0.0
 * @date 2026-02-24
 */

class FaturamentoSharedService {
    constructor(pool) {
        this.pool = pool;
        this._configCache = null;
        this._configCacheTime = 0;
        this.CONFIG_TTL = 5 * 60 * 1000; // 5 minutos de cache
    }

    // ============================================================
    // CONFIGURAÇÃO CENTRALIZADA
    // ============================================================

    /**
     * Busca configuração de faturamento do banco (com cache)
     * Tabela: configuracoes (chave = 'faturamento_config')
     * @returns {Object} { serie_padrao, prazo_vencimento_padrao, ncm_padrao, uf_emitente, ... }
     */
    async getConfig() {
        const now = Date.now();
        if (this._configCache && (now - this._configCacheTime) < this.CONFIG_TTL) {
            return this._configCache;
        }

        try {
            const [rows] = await this.pool.query(
                `SELECT valor FROM configuracoes WHERE chave = 'faturamento_config' LIMIT 1`
            );

            if (rows.length > 0) {
                const config = typeof rows[0].valor === 'string' 
                    ? JSON.parse(rows[0].valor) 
                    : rows[0].valor;
                this._configCache = { ...this.getDefaults(), ...config };
            } else {
                this._configCache = this.getDefaults();
            }
        } catch (err) {
            console.warn('[FATURAMENTO-SHARED] Erro ao buscar config, usando defaults:', err.message);
            this._configCache = this.getDefaults();
        }

        this._configCacheTime = now;
        return this._configCache;
    }

    /**
     * Valores padrão de faturamento (usado se não houver config no banco)
     */
    getDefaults() {
        return {
            serie_padrao: 1,
            uf_emitente: 'MG',
            ncm_padrao: '73269090',         // Obras de ferro/aço (padrão ALUFORCE)
            prazo_vencimento_padrao: 30,     // Dias para vencimento de contas_receber
            regime_tributario: 3,            // Lucro Real
            ambiente_sefaz: 2,               // 1=Produção, 2=Homologação
            modelo_nfe: '55',
            tipo_emissao: 1,
            zona_franca_ufs: ['AM', 'RR', 'AP', 'AC', 'RO']
        };
    }

    /**
     * Invalida cache para forçar re-leitura do banco
     */
    invalidateCache() {
        this._configCache = null;
        this._configCacheTime = 0;
    }

    // ============================================================
    // VERIFICAÇÃO DE ADMIN (CENTRALIZADA)
    // ============================================================

    /**
     * Verifica se o usuário é administrador usando APENAS dados do banco.
     * Substitui a lista hardcoded de emails/nomes.
     * @param {Object} user - Objeto req.user do JWT
     * @returns {boolean}
     */
    isAdmin(user) {
        if (!user) return false;
        
        // Verificar flag is_admin do banco de dados
        if (user.is_admin === true || user.is_admin === 1) return true;
        
        // Verificar role do banco
        const role = (user.role || '').toString().toLowerCase();
        if (['admin', 'administrador'].includes(role)) return true;
        
        // Verificar cargo para cargos de gestão com poderes admin
        const cargo = (user.cargo || '').toString().toLowerCase();
        if (['administrador', 'diretor', 'diretor geral', 'gerente geral'].includes(cargo)) return true;
        
        return false;
    }

    /**
     * Verifica se o usuário tem permissão para operações de faturamento
     * @param {Object} user - Objeto req.user do JWT
     * @returns {boolean}
     */
    canFaturar(user) {
        if (this.isAdmin(user)) return true;
        
        const role = (user.role || user.cargo || '').toString().toLowerCase();
        const rolesFaturamento = [
            'gerente', 'gerente_fiscal', 'faturista', 'fiscal', 
            'supervisor', 'supervisor_fiscal', 'vendedor'
        ];
        
        return rolesFaturamento.includes(role);
    }

    // ============================================================
    // NUMERAÇÃO NF-e UNIFICADA
    // ============================================================

    /**
     * Gera o próximo número de NF-e de forma segura e unificada.
     * Verifica TODAS as fontes de numeração (nfe, pedidos faturamento, pedidos remessa).
     * DEVE ser chamado dentro de uma transação com connection.
     * 
     * @param {Object} connection - Conexão MySQL dentro de transação
     * @param {number} [serie] - Série da NF-e (se null, busca do config)
     * @returns {Object} { numero: '000000001', serie: 1 }
     */
    async gerarProximoNumeroNFe(connection, serie = null) {
        const config = await this.getConfig();
        const serieNFe = serie || config.serie_padrao;

        // Lock global para evitar race condition — verifica TODAS as fontes
        // Usa colunas reais: pedidos.nf, pedidos.numero_nf
        let maxNfe = 0, maxNf = 0, maxNumeroNf = 0;
        try {
            const [nfRows] = await connection.query(
                'SELECT MAX(CAST(nf AS UNSIGNED)) as max_num FROM pedidos WHERE nf IS NOT NULL AND nf REGEXP "^[0-9]+$" FOR UPDATE'
            );
            maxNf = nfRows[0]?.max_num || 0;
        } catch(e) { console.warn('[FATURAMENTO-SHARED] Coluna nf não encontrada:', e.message); }
        try {
            const [numNfRows] = await connection.query(
                'SELECT MAX(CAST(numero_nf AS UNSIGNED)) as max_num FROM pedidos WHERE numero_nf IS NOT NULL AND numero_nf REGEXP "^[0-9]+$" FOR UPDATE'
            );
            maxNumeroNf = numNfRows[0]?.max_num || 0;
        } catch(e) { console.warn('[FATURAMENTO-SHARED] Coluna numero_nf não encontrada:', e.message); }

        const proximo = Math.max(maxNf, maxNumeroNf) + 1;

        return {
            numero: String(proximo).padStart(9, '0'),
            serie: serieNFe
        };
    }

    // ============================================================
    // CFOP INTELIGENTE
    // ============================================================

    /**
     * Determina o CFOP correto baseado no tipo de operação e UFs envolvidas.
     * @param {string} tipoOperacao - 'venda' | 'faturamento' | 'remessa'
     * @param {string} ufEmpresa - UF do emitente (ex: 'MG')
     * @param {string} ufCliente - UF do destinatário (ex: 'SP')
     * @param {string} [cfopManual] - CFOP informado manualmente (tem prioridade)
     * @returns {Object} { cfop: '5102', descricao: 'Venda Mercadoria - Operação Interna', tipo: 'interna' }
     */
    async determinarCFOP(tipoOperacao, ufEmpresa, ufCliente, cfopManual = null) {
        if (cfopManual) {
            return { cfop: cfopManual, descricao: 'CFOP manual', tipo: 'manual' };
        }

        const config = await this.getConfig();
        const ufEmp = (ufEmpresa || config.uf_emitente).toUpperCase();
        const ufCli = (ufCliente || '').toUpperCase();
        const isZonaFranca = config.zona_franca_ufs.includes(ufCli);
        const isInterestadual = ufEmp !== ufCli && ufCli !== '';

        const tipo = isZonaFranca ? 'zona_franca' : (isInterestadual ? 'interestadual' : 'interna');

        const CFOP_MAP = {
            venda: {
                interna: { cfop: '5102', descricao: 'Venda Mercadoria - Operação Interna' },
                interestadual: { cfop: '6102', descricao: 'Venda Mercadoria - Operação Interestadual' },
                zona_franca: { cfop: '7102', descricao: 'Venda Mercadoria - Zona Franca de Manaus' }
            },
            faturamento: {
                interna: { cfop: '5922', descricao: 'Simples Faturamento - Operação Interna' },
                interestadual: { cfop: '6922', descricao: 'Simples Faturamento - Operação Interestadual' },
                zona_franca: { cfop: '7922', descricao: 'Simples Faturamento - Zona Franca de Manaus' }
            },
            remessa: {
                interna: { cfop: '5117', descricao: 'Remessa Entrega Futura - Operação Interna' },
                interestadual: { cfop: '6117', descricao: 'Remessa Entrega Futura - Operação Interestadual' },
                zona_franca: { cfop: '7117', descricao: 'Remessa Entrega Futura - Zona Franca de Manaus' }
            }
        };

        const operacao = CFOP_MAP[tipoOperacao] || CFOP_MAP.venda;
        const resultado = operacao[tipo] || operacao.interna;

        return { ...resultado, tipo };
    }

    // ============================================================
    // CONTAS A RECEBER — VENCIMENTO INTELIGENTE
    // ============================================================

    /**
     * Calcula a data de vencimento de uma conta a receber.
     * Usa o prazo_pagamento do pedido se disponível, senão usa config global.
     * 
     * @param {Object} pedido - Dados do pedido (condicao_pagamento, parcelas)
     * @returns {string} Expressão SQL para data_vencimento
     */
    calcularVencimentoSQL(pedido) {
        // Tentar extrair dias do campo condicao_pagamento
        // Formatos comuns: "30 dias", "30/60/90", "30DDL", "À Vista", "28 DDL"
        let diasVencimento = null;

        if (pedido && pedido.condicao_pagamento) {
            const condicao = pedido.condicao_pagamento.toString().trim().toLowerCase();

            // "à vista" ou "a vista" = 0 dias
            if (condicao.includes('vista') || condicao === '0') {
                diasVencimento = 0;
            }
            // "30 dias", "30ddl", "30 DDL" = extrair primeiro número
            else {
                const match = condicao.match(/(\d+)/);
                if (match) {
                    diasVencimento = parseInt(match[1]);
                }
            }
        }

        // Se não conseguiu extrair do pedido, usar prazo padrão
        if (diasVencimento === null) {
            // Valor será substituído pelo caller com o config
            diasVencimento = null;
        }

        return diasVencimento;
    }

    /**
     * Gera o INSERT de contas_receber com vencimento inteligente.
     * Usa o prazo do pedido quando disponível, senão o prazo padrão do config.
     * 
     * @param {Object} connection - Conexão MySQL
     * @param {Object} params - { pedido_id, cliente_id, descricao, valor, tipo, pedido }
     * @returns {Object} { insertId, data_vencimento_dias }
     */
    async gerarContaReceber(connection, { pedido_id, cliente_id, descricao, valor, tipo, pedido }) {
        const config = await this.getConfig();
        const diasPedido = this.calcularVencimentoSQL(pedido);
        const dias = diasPedido !== null ? diasPedido : config.prazo_vencimento_padrao;

        const [result] = await connection.query(`
            INSERT INTO contas_receber (pedido_id, cliente_id, descricao, valor, data_vencimento, status, tipo)
            VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'pendente', ?)
        `, [pedido_id, cliente_id, descricao, valor, dias, tipo]);

        return { insertId: result.insertId, data_vencimento_dias: dias };
    }

    // ============================================================
    // ENDPOINT DE CONFIGURAÇÃO (para exposição via API)
    // ============================================================

    /**
     * Retorna as configurações atuais para o frontend
     */
    async getConfigForAPI() {
        const config = await this.getConfig();
        return {
            serie_padrao: config.serie_padrao,
            uf_emitente: config.uf_emitente,
            ncm_padrao: config.ncm_padrao,
            prazo_vencimento_padrao: config.prazo_vencimento_padrao,
            regime_tributario: config.regime_tributario,
            ambiente_sefaz: config.ambiente_sefaz,
            zona_franca_ufs: config.zona_franca_ufs
        };
    }

    /**
     * Atualiza configurações de faturamento no banco
     * @param {Object} novaConfig - Campos a atualizar
     */
    async updateConfig(novaConfig) {
        const configAtual = await this.getConfig();
        const merged = { ...configAtual, ...novaConfig };

        // Validações
        if (merged.serie_padrao < 1 || merged.serie_padrao > 999) {
            throw new Error('Série NF-e deve estar entre 1 e 999');
        }
        if (merged.prazo_vencimento_padrao < 0 || merged.prazo_vencimento_padrao > 365) {
            throw new Error('Prazo de vencimento deve estar entre 0 e 365 dias');
        }
        if (!merged.uf_emitente || merged.uf_emitente.length !== 2) {
            throw new Error('UF do emitente deve ter 2 caracteres');
        }

        await this.pool.query(`
            INSERT INTO configuracoes (chave, valor, updated_at) 
            VALUES ('faturamento_config', ?, NOW())
            ON DUPLICATE KEY UPDATE valor = VALUES(valor), updated_at = NOW()
        `, [JSON.stringify(merged)]);

        this.invalidateCache();
        return merged;
    }
}

// Singleton por pool
let instance = null;

/**
 * Factory para obter instância do serviço (singleton por pool)
 * @param {Object} pool - MySQL pool
 * @returns {FaturamentoSharedService}
 */
function getFaturamentoSharedService(pool) {
    if (!instance) {
        instance = new FaturamentoSharedService(pool);
    }
    return instance;
}

module.exports = { FaturamentoSharedService, getFaturamentoSharedService };
