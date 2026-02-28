// =================================================================
// ROTAS API CONFIGURAÇÃO FISCAL - ALUFORCE v2.0
// Endpoints para gerenciar regime tributário, regras fiscais por NCM
// =================================================================
'use strict';

const express = require('express');
const router = express.Router();

function createFiscalConfigRouter(pool, authenticateToken, requireAdmin) {

    // ============================================================
    // REGIME TRIBUTÁRIO
    // ============================================================

    /**
     * GET /api/fiscal/regime
     * Retorna o regime tributário configurado da empresa
     */
    router.get('/regime', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT regime_tributario, crt, nfe_ambiente, nfe_serie, nfe_proximo_numero FROM empresa_config WHERE id = 1'
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Configuração não encontrada' });
            }
            const cfg = rows[0];
            res.json({
                regime_tributario: cfg.regime_tributario || 'simples',
                crt: cfg.crt || 1,
                descricao: {
                    'simples': 'Simples Nacional (CRT 1)',
                    'simples_excesso': 'Simples Nacional - Excesso de Sublimite (CRT 2)',
                    'normal': 'Regime Normal - Lucro Real / Lucro Presumido (CRT 3)'
                }[cfg.regime_tributario || 'simples'],
                nfe_ambiente: cfg.nfe_ambiente || 2,
                nfe_ambiente_descricao: cfg.nfe_ambiente === 1 ? 'Produção' : 'Homologação',
                nfe_serie: cfg.nfe_serie || 1,
                nfe_proximo_numero: cfg.nfe_proximo_numero || 1
            });
        } catch (error) {
            console.error('❌ Erro ao buscar regime tributário:', error);
            res.status(500).json({ error: 'Erro ao buscar regime tributário' });
        }
    });

    /**
     * PUT /api/fiscal/regime
     * Atualiza o regime tributário (somente admin)
     */
    router.put('/regime', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { regime_tributario, nfe_ambiente, nfe_serie } = req.body;

            if (!['simples', 'simples_excesso', 'normal'].includes(regime_tributario)) {
                return res.status(400).json({
                    error: 'Regime inválido. Use: simples, simples_excesso ou normal'
                });
            }

            // Calcular CRT
            const crtMap = { simples: 1, simples_excesso: 2, normal: 3 };
            const crt = crtMap[regime_tributario];

            await pool.query(`
                UPDATE empresa_config SET
                    regime_tributario = ?,
                    crt = ?,
                    nfe_ambiente = COALESCE(?, nfe_ambiente),
                    nfe_serie = COALESCE(?, nfe_serie),
                    updated_by = ?
                WHERE id = 1
            `, [regime_tributario, crt, nfe_ambiente || null, nfe_serie || null, req.user.id]);

            res.json({
                success: true,
                regime_tributario,
                crt,
                message: `Regime alterado para ${regime_tributario} (CRT ${crt})`
            });
        } catch (error) {
            console.error('❌ Erro ao atualizar regime tributário:', error);
            res.status(500).json({ error: 'Erro ao atualizar regime tributário' });
        }
    });

    // ============================================================
    // REGRAS FISCAIS POR NCM
    // ============================================================

    /**
     * GET /api/fiscal/regras-ncm
     * Lista todas as regras fiscais por NCM
     */
    router.get('/regras-ncm', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT * FROM regras_fiscais_ncm WHERE ativo = TRUE ORDER BY ncm'
            );
            res.json({ total: rows.length, regras: rows });
        } catch (error) {
            console.error('❌ Erro ao buscar regras NCM:', error);
            res.status(500).json({ error: 'Erro ao buscar regras NCM' });
        }
    });

    /**
     * GET /api/fiscal/regras-ncm/:ncm
     * Busca regra fiscal por NCM específico
     */
    router.get('/regras-ncm/:ncm', authenticateToken, async (req, res) => {
        try {
            const ncm = req.params.ncm.replace(/\D/g, '');
            const [rows] = await pool.query(
                'SELECT * FROM regras_fiscais_ncm WHERE ncm = ? AND ativo = TRUE',
                [ncm]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: `Regra para NCM ${ncm} não encontrada` });
            }
            res.json(rows[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar regra NCM:', error);
            res.status(500).json({ error: 'Erro ao buscar regra NCM' });
        }
    });

    /**
     * POST /api/fiscal/regras-ncm
     * Cria nova regra fiscal por NCM
     */
    router.post('/regras-ncm', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const d = req.body;
            if (!d.ncm || d.ncm.replace(/\D/g, '').length !== 8) {
                return res.status(400).json({ error: 'NCM deve ter 8 dígitos' });
            }

            const [result] = await pool.query(`
                INSERT INTO regras_fiscais_ncm (
                    ncm, descricao, cst_icms_padrao, csosn_icms_padrao, aliquota_icms_padrao,
                    reducao_bc_padrao, cst_ipi_padrao, aliquota_ipi_padrao, ex_tipi,
                    cst_pis_padrao, cst_cofins_padrao, monofasico, cest,
                    classe_tributaria_ibs, classe_tributaria_cbs
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    descricao = VALUES(descricao),
                    cst_icms_padrao = VALUES(cst_icms_padrao),
                    aliquota_ipi_padrao = VALUES(aliquota_ipi_padrao)
            `, [
                d.ncm.replace(/\D/g, ''),
                d.descricao || null,
                d.cst_icms_padrao || '00',
                d.csosn_icms_padrao || '102',
                d.aliquota_icms_padrao != null ? parseFloat(d.aliquota_icms_padrao) : null,
                parseFloat(d.reducao_bc_padrao || 0),
                d.cst_ipi_padrao || '99',
                parseFloat(d.aliquota_ipi_padrao || 0),
                d.ex_tipi || null,
                d.cst_pis_padrao || '01',
                d.cst_cofins_padrao || '01',
                d.monofasico ? 1 : 0,
                d.cest || null,
                d.classe_tributaria_ibs || null,
                d.classe_tributaria_cbs || null
            ]);

            res.json({ success: true, id: result.insertId, message: 'Regra NCM criada' });
        } catch (error) {
            console.error('❌ Erro ao criar regra NCM:', error);
            res.status(500).json({ error: 'Erro ao criar regra NCM' });
        }
    });

    /**
     * POST /api/fiscal/aplicar-ncm/:produtoId
     * Aplica regras do NCM automaticamente num produto
     */
    router.post('/aplicar-ncm/:produtoId', authenticateToken, async (req, res) => {
        try {
            const { produtoId } = req.params;

            // Buscar NCM do produto
            const [produtos] = await pool.query('SELECT id, ncm, nome FROM produtos WHERE id = ?', [produtoId]);
            if (produtos.length === 0) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }

            const ncm = (produtos[0].ncm || '').replace(/\D/g, '');
            if (ncm.length !== 8) {
                return res.status(400).json({ error: `Produto "${produtos[0].nome}" tem NCM inválido: "${ncm}"` });
            }

            // Buscar regra do NCM
            const [regras] = await pool.query(
                'SELECT * FROM regras_fiscais_ncm WHERE ncm = ? AND ativo = TRUE', [ncm]
            );
            if (regras.length === 0) {
                return res.status(404).json({ error: `Sem regra fiscal cadastrada para NCM ${ncm}` });
            }

            const r = regras[0];

            // Aplicar regras ao produto
            await pool.query(`
                UPDATE produtos SET
                    cst_icms = COALESCE(?, cst_icms),
                    csosn_icms = COALESCE(?, csosn_icms),
                    aliquota_icms = COALESCE(?, aliquota_icms),
                    reducao_bc_icms = COALESCE(?, reducao_bc_icms),
                    cst_ipi = COALESCE(?, cst_ipi),
                    aliquota_ipi = COALESCE(?, aliquota_ipi),
                    ex_tipi = COALESCE(?, ex_tipi),
                    cst_pis = COALESCE(?, cst_pis),
                    cst_cofins = COALESCE(?, cst_cofins),
                    cest = COALESCE(?, cest),
                    classe_tributaria_ibs = COALESCE(?, classe_tributaria_ibs),
                    classe_tributaria_cbs = COALESCE(?, classe_tributaria_cbs)
                WHERE id = ?
            `, [
                r.cst_icms_padrao, r.csosn_icms_padrao, r.aliquota_icms_padrao,
                r.reducao_bc_padrao, r.cst_ipi_padrao, r.aliquota_ipi_padrao,
                r.ex_tipi, r.cst_pis_padrao, r.cst_cofins_padrao,
                r.cest, r.classe_tributaria_ibs, r.classe_tributaria_cbs,
                produtoId
            ]);

            res.json({
                success: true,
                message: `Regras do NCM ${ncm} aplicadas ao produto "${produtos[0].nome}"`,
                regra_aplicada: r
            });
        } catch (error) {
            console.error('❌ Erro ao aplicar regra NCM:', error);
            res.status(500).json({ error: 'Erro ao aplicar regra NCM' });
        }
    });

    /**
     * POST /api/fiscal/aplicar-ncm-todos
     * Aplica regras NCM automaticamente em TODOS os produtos com NCM cadastrado
     */
    router.post('/aplicar-ncm-todos', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const [produtos] = await pool.query(
                "SELECT id, ncm, nome FROM produtos WHERE ncm IS NOT NULL AND ncm != '' AND LENGTH(REPLACE(ncm, '.', '')) = 8"
            );

            let aplicados = 0;
            let semRegra = 0;
            const erros = [];

            for (const produto of produtos) {
                const ncm = produto.ncm.replace(/\D/g, '');
                const [regras] = await pool.query(
                    'SELECT * FROM regras_fiscais_ncm WHERE ncm = ? AND ativo = TRUE', [ncm]
                );
                if (regras.length === 0) {
                    semRegra++;
                    continue;
                }
                const r = regras[0];
                try {
                    await pool.query(`
                        UPDATE produtos SET
                            cst_icms = ?, csosn_icms = ?, aliquota_icms = ?, reducao_bc_icms = ?,
                            cst_ipi = ?, aliquota_ipi = ?, ex_tipi = ?,
                            cst_pis = ?, cst_cofins = ?, cest = ?,
                            classe_tributaria_ibs = ?, classe_tributaria_cbs = ?
                        WHERE id = ?
                    `, [
                        r.cst_icms_padrao, r.csosn_icms_padrao, r.aliquota_icms_padrao,
                        r.reducao_bc_padrao, r.cst_ipi_padrao, r.aliquota_ipi_padrao,
                        r.ex_tipi, r.cst_pis_padrao, r.cst_cofins_padrao,
                        r.cest, r.classe_tributaria_ibs, r.classe_tributaria_cbs,
                        produto.id
                    ]);
                    aplicados++;
                } catch (err) {
                    erros.push({ produto: produto.nome, erro: err.message });
                }
            }

            res.json({
                success: true,
                total_produtos: produtos.length,
                aplicados,
                sem_regra: semRegra,
                erros: erros.length > 0 ? erros : undefined,
                message: `Regras aplicadas em ${aplicados} produtos`
            });
        } catch (error) {
            console.error('❌ Erro ao aplicar regras NCM em massa:', error);
            res.status(500).json({ error: 'Erro ao aplicar regras NCM' });
        }
    });

    // ============================================================
    // ST ALÍQUOTAS POR FORNECEDOR / UF / REGIME
    // ============================================================

    /**
     * GET /api/fiscal/st-aliquotas
     * Lista alíquotas ST. Filtros opcionais: ?fornecedor=&uf=&regime=
     */
    router.get('/st-aliquotas', authenticateToken, async (req, res) => {
        try {
            const { fornecedor, uf, regime, ativo } = req.query;
            let sql = 'SELECT * FROM st_aliquotas_fornecedor WHERE 1=1';
            const params = [];

            if (fornecedor) { sql += ' AND fornecedor LIKE ?'; params.push(`%${fornecedor}%`); }
            if (uf) { sql += ' AND uf_destino = ?'; params.push(uf.toUpperCase()); }
            if (regime) { sql += ' AND regime_tributario = ?'; params.push(regime); }
            if (ativo !== undefined) { sql += ' AND ativo = ?'; params.push(Number(ativo)); }
            else { sql += ' AND ativo = 1'; }

            sql += ' ORDER BY fornecedor, regime_tributario, uf_destino';
            const [rows] = await pool.query(sql, params);

            // Agrupar por fornecedor > regime para facilitar exibição
            const agrupado = {};
            rows.forEach(r => {
                const key = `${r.fornecedor}|${r.regime_tributario}`;
                if (!agrupado[key]) {
                    agrupado[key] = {
                        fornecedor: r.fornecedor,
                        regime_tributario: r.regime_tributario,
                        descricao_regime: r.descricao_regime,
                        estados: []
                    };
                }
                agrupado[key].estados.push({
                    id: r.id,
                    uf: r.uf_destino,
                    aliquota_st: Number(r.aliquota_st),
                    ncm: r.ncm,
                    observacao: r.observacao
                });
            });

            res.json({
                total: rows.length,
                dados: rows,
                agrupado: Object.values(agrupado)
            });
        } catch (error) {
            console.error('[FISCAL] Erro ao listar ST alíquotas:', error.message);
            res.status(500).json({ error: 'Erro ao buscar alíquotas ST' });
        }
    });

    /**
     * GET /api/fiscal/st-aliquotas/fornecedores
     * Lista fornecedores distintos que possuem tabela ST
     */
    router.get('/st-aliquotas/fornecedores', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT fornecedor, COUNT(*) as total_aliquotas,
                       GROUP_CONCAT(DISTINCT regime_tributario) as regimes,
                       GROUP_CONCAT(DISTINCT uf_destino ORDER BY uf_destino) as estados
                FROM st_aliquotas_fornecedor WHERE ativo = 1
                GROUP BY fornecedor ORDER BY fornecedor
            `);
            res.json(rows);
        } catch (error) {
            console.error('[FISCAL] Erro ao listar fornecedores ST:', error.message);
            res.status(500).json({ error: 'Erro ao buscar fornecedores ST' });
        }
    });

    /**
     * GET /api/fiscal/st-aliquotas/consultar
     * Consulta alíquota ST específica: ?fornecedor=LABOR ENERGY&uf=SP&regime=simples_nacional
     */
    router.get('/st-aliquotas/consultar', authenticateToken, async (req, res) => {
        try {
            const { fornecedor, uf, regime } = req.query;
            if (!fornecedor || !uf || !regime) {
                return res.status(400).json({ error: 'Parâmetros obrigatórios: fornecedor, uf, regime' });
            }
            const [rows] = await pool.query(
                `SELECT * FROM st_aliquotas_fornecedor 
                 WHERE fornecedor = ? AND uf_destino = ? AND regime_tributario = ? AND ativo = 1`,
                [fornecedor.toUpperCase(), uf.toUpperCase(), regime]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Alíquota ST não encontrada para esta combinação' });
            }
            res.json(rows[0]);
        } catch (error) {
            console.error('[FISCAL] Erro ao consultar ST:', error.message);
            res.status(500).json({ error: 'Erro ao consultar alíquota ST' });
        }
    });

    /**
     * POST /api/fiscal/st-aliquotas
     * Criar ou atualizar alíquota ST
     */
    router.post('/st-aliquotas', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { fornecedor, uf_destino, regime_tributario, aliquota_st, descricao_regime, ncm, observacao } = req.body;
            if (!fornecedor || !uf_destino || !regime_tributario || aliquota_st === undefined) {
                return res.status(400).json({ error: 'Campos obrigatórios: fornecedor, uf_destino, regime_tributario, aliquota_st' });
            }
            const [result] = await pool.query(
                `INSERT INTO st_aliquotas_fornecedor 
                 (fornecedor, uf_destino, regime_tributario, aliquota_st, descricao_regime, ncm, observacao)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE aliquota_st = VALUES(aliquota_st), 
                    descricao_regime = VALUES(descricao_regime), observacao = VALUES(observacao), ativo = 1`,
                [fornecedor.toUpperCase(), uf_destino.toUpperCase(), regime_tributario, aliquota_st, descricao_regime || null, ncm || null, observacao || null]
            );
            res.status(201).json({ success: true, id: result.insertId || result.affectedRows, message: 'Alíquota ST salva' });
        } catch (error) {
            console.error('[FISCAL] Erro ao salvar ST:', error.message);
            res.status(500).json({ error: 'Erro ao salvar alíquota ST' });
        }
    });

    /**
     * POST /api/fiscal/st-aliquotas/importar-lote
     * Importar várias alíquotas de uma vez
     * Body: { aliquotas: [{ fornecedor, uf_destino, regime_tributario, aliquota_st, descricao_regime }] }
     */
    router.post('/st-aliquotas/importar-lote', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { aliquotas } = req.body;
            if (!Array.isArray(aliquotas) || aliquotas.length === 0) {
                return res.status(400).json({ error: 'Envie um array "aliquotas" com os dados' });
            }
            const sql = `INSERT INTO st_aliquotas_fornecedor 
                         (fornecedor, uf_destino, regime_tributario, aliquota_st, descricao_regime, ncm, observacao)
                         VALUES (?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE aliquota_st = VALUES(aliquota_st), 
                            descricao_regime = VALUES(descricao_regime), ativo = 1`;
            let inseridos = 0, erros = [];
            for (const a of aliquotas) {
                try {
                    await pool.query(sql, [
                        (a.fornecedor || '').toUpperCase(),
                        (a.uf_destino || '').toUpperCase(),
                        a.regime_tributario,
                        a.aliquota_st,
                        a.descricao_regime || null,
                        a.ncm || null,
                        a.observacao || null
                    ]);
                    inseridos++;
                } catch (e) {
                    erros.push({ dados: a, erro: e.message });
                }
            }
            res.json({ success: true, inseridos, erros: erros.length, detalhes_erros: erros.length > 0 ? erros : undefined });
        } catch (error) {
            console.error('[FISCAL] Erro ao importar lote ST:', error.message);
            res.status(500).json({ error: 'Erro ao importar lote' });
        }
    });

    /**
     * PUT /api/fiscal/st-aliquotas/:id
     * Atualizar alíquota ST específica
     */
    router.put('/st-aliquotas/:id', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { aliquota_st, descricao_regime, ncm, observacao, ativo } = req.body;
            const fields = [];
            const params = [];
            if (aliquota_st !== undefined) { fields.push('aliquota_st = ?'); params.push(aliquota_st); }
            if (descricao_regime !== undefined) { fields.push('descricao_regime = ?'); params.push(descricao_regime); }
            if (ncm !== undefined) { fields.push('ncm = ?'); params.push(ncm); }
            if (observacao !== undefined) { fields.push('observacao = ?'); params.push(observacao); }
            if (ativo !== undefined) { fields.push('ativo = ?'); params.push(Number(ativo)); }
            if (fields.length === 0) {
                return res.status(400).json({ error: 'Nenhum campo para atualizar' });
            }
            params.push(id);
            await pool.query(`UPDATE st_aliquotas_fornecedor SET ${fields.join(', ')} WHERE id = ?`, params);
            res.json({ success: true, message: 'Alíquota ST atualizada' });
        } catch (error) {
            console.error('[FISCAL] Erro ao atualizar ST:', error.message);
            res.status(500).json({ error: 'Erro ao atualizar alíquota ST' });
        }
    });

    /**
     * DELETE /api/fiscal/st-aliquotas/:id
     * Desativar (soft delete) alíquota ST
     */
    router.delete('/st-aliquotas/:id', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('UPDATE st_aliquotas_fornecedor SET ativo = 0 WHERE id = ?', [id]);
            res.json({ success: true, message: 'Alíquota ST desativada' });
        } catch (error) {
            console.error('[FISCAL] Erro ao deletar ST:', error.message);
            res.status(500).json({ error: 'Erro ao desativar alíquota ST' });
        }
    });

    return router;
}

module.exports = createFiscalConfigRouter;
