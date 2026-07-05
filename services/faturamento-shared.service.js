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
        this._infrastructurePromise = null;
    }

    async ensureInfrastructure() {
        if (!this._infrastructurePromise) {
            this._infrastructurePromise = (async () => {
                await this.pool.query(`
                    CREATE TABLE IF NOT EXISTS nfe_sequences (
                        serie SMALLINT UNSIGNED NOT NULL,
                        current_value INT UNSIGNED NOT NULL DEFAULT 0,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (serie)
                    ) ENGINE=InnoDB
                `);

                const ajustes = [
                    `ALTER TABLE nfes ADD COLUMN emitente_uf VARCHAR(2) NULL`,
                    `ALTER TABLE nfes ADD COLUMN emitente_cnpj VARCHAR(20) NULL`,
                    `CREATE UNIQUE INDEX uq_nfes_serie_numero ON nfes (serie, numero)`
                ];
                for (const sql of ajustes) {
                    try {
                        await this.pool.query(sql);
                    } catch (error) {
                        if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) {
                            console.warn('[FATURAMENTO-SHARED] Ajuste de infraestrutura pendente:', error.message);
                        }
                    }
                }
            })().catch((error) => {
                this._infrastructurePromise = null;
                throw error;
            });
        }
        await this._infrastructurePromise;
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
        await this.ensureInfrastructure();
        const config = await this.getConfig();
        const serieNFe = Number(serie || config.serie_padrao);
        if (!Number.isInteger(serieNFe) || serieNFe < 1 || serieNFe > 999) {
            throw new Error('Série NF-e inválida. Informe um número entre 1 e 999.');
        }

        await connection.query(
            `INSERT IGNORE INTO nfe_sequences (serie, current_value) VALUES (?, 0)`,
            [serieNFe]
        );
        const [[sequenceState]] = await connection.query(
            `SELECT current_value FROM nfe_sequences WHERE serie = ? FOR UPDATE`,
            [serieNFe]
        );

        // O custo de ler tabelas legadas ocorre somente na primeira reserva da série.
        if (Number(sequenceState?.current_value || 0) === 0) {
            const maximos = [];
            const buscarMaximo = async (sql, params = []) => {
                try {
                    const [[row]] = await connection.query(sql, params);
                    maximos.push(Number(row?.max_num || 0));
                } catch (_) {
                    // Instalações antigas podem não ter todas as colunas/tabelas.
                }
            };

            await buscarMaximo(
                'SELECT MAX(CAST(nf AS UNSIGNED)) AS max_num FROM pedidos WHERE nf IS NOT NULL AND nf REGEXP "^[0-9]+$"'
            );
            await buscarMaximo(
                'SELECT MAX(CAST(numero_nf AS UNSIGNED)) AS max_num FROM pedidos WHERE numero_nf IS NOT NULL AND numero_nf REGEXP "^[0-9]+$"'
            );
            await buscarMaximo(
                'SELECT MAX(CAST(numero AS UNSIGNED)) AS max_num FROM nfes WHERE serie = ? AND numero IS NOT NULL',
                [serieNFe]
            );
            await buscarMaximo(`
                SELECT GREATEST(
                    COALESCE(MAX(CASE WHEN nfe_faturamento_numero REGEXP '^[0-9]+$'
                        THEN CAST(nfe_faturamento_numero AS UNSIGNED) ELSE 0 END), 0),
                    COALESCE(MAX(CASE WHEN nfe_remessa_numero REGEXP '^[0-9]+$'
                        THEN CAST(nfe_remessa_numero AS UNSIGNED) ELSE 0 END), 0)
                ) AS max_num
                FROM pedidos
            `);
            await buscarMaximo(`
                SELECT MAX(CAST(nfe_numero AS UNSIGNED)) AS max_num
                FROM pedido_faturamentos
                WHERE nfe_numero IS NOT NULL AND nfe_numero REGEXP '^[0-9]+$'
            `);
            await buscarMaximo(
                'SELECT MAX(ultimo_numero) AS max_num FROM nfe_configuracoes WHERE serie = ?',
                [serieNFe]
            );
            await buscarMaximo(
                'SELECT MAX(nfe_proximo_numero - 1) AS max_num FROM empresa_config WHERE nfe_serie = ?',
                [serieNFe]
            );

            await connection.query(
                `UPDATE nfe_sequences SET current_value = ? WHERE serie = ?`,
                [Math.max(0, ...maximos), serieNFe]
            );
        }

        await connection.query(
            `UPDATE nfe_sequences
             SET current_value = LAST_INSERT_ID(current_value + 1)
             WHERE serie = ?`,
            [serieNFe]
        );
        const [[sequenceRow]] = await connection.query('SELECT LAST_INSERT_ID() AS numero');
        const proximo = Number(sequenceRow?.numero);
        if (!Number.isInteger(proximo) || proximo < 1 || proximo > 999999999) {
            throw new Error('Faixa de numeração NF-e esgotada para a série configurada');
        }

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
    // CONTAS A RECEBER — VENCIMENTO INTELIGENTE COM PARCELAS
    // ============================================================

    /**
     * Extrai prazos de parcelas de uma condição de pagamento.
     * "30/60/90" → [30, 60, 90]
     * "30 dias" → [30]
     * "À Vista" → [0]
     * @param {Object} pedido - Dados do pedido
     * @returns {number[]} Array de dias para cada parcela
     */
    extrairParcelas(pedido) {
        if (!pedido || !pedido.condicao_pagamento) return null;
        const condicao = pedido.condicao_pagamento.toString().trim().toLowerCase();

        // "à vista" ou "a vista"
        if (condicao.includes('vista') || condicao === '0') return [0];

        // "30/60/90" ou "30-60-90" ou "30,60,90"
        const partes = condicao.split(/[\/\-,]+/).map(p => p.trim());
        const numeros = partes.map(p => {
            const m = p.match(/(\d+)/);
            return m ? parseInt(m[1]) : null;
        }).filter(n => n !== null && n >= 0);

        return numeros.length > 0 ? numeros : null;
    }

    /**
     * Gera contas_receber com suporte a parcelas (30/60/90).
     * Se a condição de pagamento tiver múltiplos prazos, divide o valor
     * igualmente entre as parcelas e gera um registro para cada.
     * 
     * @param {Object} connection - Conexão MySQL
     * @param {Object} params - { pedido_id, cliente_id, descricao, valor, tipo, pedido }
     * @returns {Object} { insertId (primeira parcela), data_vencimento_dias, parcelas_geradas, total_parcelas }
     */
    async gerarContaReceber(connection, { pedido_id, cliente_id, descricao, valor, tipo, pedido }) {
        const config = await this.getConfig();
        const prazos = this.extrairParcelas(pedido);

        // Se tem múltiplas parcelas, gerar uma conta para cada
        if (prazos && prazos.length > 1) {
            const totalParcelas = prazos.length;
            const valorParcela = Math.round((valor / totalParcelas) * 100) / 100;
            // Ajuste de centavos na última parcela
            const valorUltimaParcela = Math.round((valor - valorParcela * (totalParcelas - 1)) * 100) / 100;
            let primeiroId = null;
            const parcelasGeradas = [];

            for (let i = 0; i < totalParcelas; i++) {
                const dias = prazos[i];
                const valorParcAtual = (i === totalParcelas - 1) ? valorUltimaParcela : valorParcela;
                const descParcela = `${descricao} (${i + 1}/${totalParcelas})`;

                const [result] = await connection.query(`
                    INSERT INTO contas_receber (pedido_id, cliente_id, descricao, valor, data_vencimento, status, tipo, parcela_numero, total_parcelas)
                    VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'pendente', ?, ?, ?)
                `, [pedido_id, cliente_id, descParcela, valorParcAtual, dias, tipo, i + 1, totalParcelas]);

                if (i === 0) primeiroId = result.insertId;
                parcelasGeradas.push({ id: result.insertId, parcela: i + 1, dias, valor: valorParcAtual });
            }

            return { insertId: primeiroId, data_vencimento_dias: prazos[0], parcelas_geradas: parcelasGeradas, total_parcelas: totalParcelas };
        }

        // Parcela única (comportamento original)
        const dias = (prazos && prazos.length === 1) ? prazos[0] : config.prazo_vencimento_padrao;

        const [result] = await connection.query(`
            INSERT INTO contas_receber (pedido_id, cliente_id, descricao, valor, data_vencimento, status, tipo, parcela_numero, total_parcelas)
            VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'pendente', ?, 1, 1)
        `, [pedido_id, cliente_id, descricao, valor, dias, tipo]);

        return { insertId: result.insertId, data_vencimento_dias: dias, parcelas_geradas: [{ id: result.insertId, parcela: 1, dias, valor }], total_parcelas: 1 };
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
