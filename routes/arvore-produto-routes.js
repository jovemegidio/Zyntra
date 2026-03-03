// routes/arvore-produto-routes.js
// API routes for the Product Cost Tree (Árvore de Produto com Custo)
// Mounted on /api/pcp/arvore-produto

module.exports = function createArvoreProdutoRoutes({ pool, authenticateToken, authorizeArea }) {
    const express = require('express');
    const router = express.Router();

    // Middleware
    router.use(authenticateToken);
    router.use(authorizeArea('pcp'));

    // ============================================================
    // GET /parametros - List all cost parameters
    // ============================================================
    router.get('/parametros', async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT * FROM arvore_produto_parametros WHERE ativo = 1 ORDER BY tipo, nome'
            );
            res.json({ success: true, parametros: rows });
        } catch (error) {
            console.error('[ARVORE-PRODUTO] Erro ao buscar parâmetros:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // PUT /parametros/:id - Update a cost parameter
    // ============================================================
    router.put('/parametros/:id', async (req, res) => {
        try {
            const { valor } = req.body;
            await pool.query(
                'UPDATE arvore_produto_parametros SET valor = ? WHERE id = ?',
                [valor, req.params.id]
            );
            res.json({ success: true, message: 'Parâmetro atualizado' });
        } catch (error) {
            console.error('[ARVORE-PRODUTO] Erro ao atualizar parâmetro:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // POST /recalcular - Recalculate all product costs
    // ============================================================
    router.post('/recalcular', async (req, res) => {
        try {
            // Get parameters
            const [paramRows] = await pool.query('SELECT nome, valor FROM arvore_produto_parametros WHERE ativo = 1');
            const P = {};
            for (const r of paramRows) P[r.nome] = parseFloat(r.valor);

            const markup = P.markup / 100;
            const percComissao = P.perc_comissao / 100;
            const percBobina = P.perc_bobina / 100;
            const percFiscal = P.perc_fiscal / 100;
            const percFrete = P.perc_frete / 100;
            const percCustoFixo = P.perc_custo_fixo / 100;
            const percFinanceira = P.perc_financeira / 100;

            // Get all active products
            const [products] = await pool.query('SELECT * FROM cabos_composicao WHERE ativo = 1');

            let updated = 0;
            for (const prod of products) {
                const custoAL = parseFloat(prod.peso_aluminio_kg_m || 0) * P.preco_aluminio;
                const custoPE = parseFloat(prod.peso_pe_kg_m || 0) * P.preco_pe;
                const custoXLPE = parseFloat(prod.peso_xlpe_kg_m || 0) * P.preco_xlpe;
                const custoXLPE_AT = parseFloat(prod.peso_xlpe_at_kg_m || 0) * P.preco_xlpe_at;
                const custoHEPR = parseFloat(prod.peso_hepr_kg_m || 0) * P.preco_hepr;
                const custoPVC = parseFloat(prod.peso_pvc_kg_m || 0) * P.preco_pvc;

                const pesoMBUV = parseFloat(prod.peso_mbuvpt_kg_m || 0) +
                    parseFloat(prod.peso_mbuvcz_kg_m || 0) +
                    parseFloat(prod.peso_mbuvvm_kg_m || 0) +
                    parseFloat(prod.peso_mbuvaz_kg_m || 0) +
                    parseFloat(prod.peso_mbpeam_kg_m || 0) +
                    parseFloat(prod.peso_mbpevd_kg_m || 0) +
                    parseFloat(prod.peso_mbpevm_kg_m || 0) +
                    parseFloat(prod.peso_mbpeaz_kg_m || 0) +
                    parseFloat(prod.peso_mbpebc_kg_m || 0) +
                    parseFloat(prod.peso_mbpelj_kg_m || 0) +
                    parseFloat(prod.peso_mbpemr_kg_m || 0) +
                    parseFloat(prod.peso_mbpvccz_kg_m || 0) +
                    parseFloat(prod.peso_mbpvcpt_kg_m || 0);
                const custoMBUV = pesoMBUV * P.preco_mbuv;

                const CMP = custoAL + custoPE + custoXLPE + custoXLPE_AT + custoHEPR + custoPVC + custoMBUV;
                const precoSugerido = CMP * (1 + markup);
                const MB = precoSugerido - CMP;
                const MBPerc = precoSugerido > 0 ? (MB / precoSugerido) : 0;

                const despComissao = precoSugerido * percComissao;
                const despBobina = precoSugerido * percBobina;
                const despFiscal = precoSugerido * percFiscal;
                const despFrete = precoSugerido * percFrete;
                const despCustoFixo = precoSugerido * percCustoFixo;
                const despFinanceira = precoSugerido * percFinanceira;

                const totalDespesas = despComissao + despBobina + despFiscal + despFrete + despCustoFixo + despFinanceira;
                const ML = precoSugerido - (totalDespesas + CMP);
                const MLPerc = precoSugerido > 0 ? (ML / precoSugerido) : 0;

                await pool.query(`
                    UPDATE cabos_composicao SET
                        custo_aluminio = ?, custo_pe = ?, custo_xlpe = ?, custo_xlpe_at = ?,
                        custo_hepr = ?, custo_pvc = ?, custo_mbuv = ?,
                        custo_material_metro = ?, preco_sugerido = ?,
                        margem_bruta_valor = ?, margem_bruta_perc = ?,
                        desp_comissao = ?, desp_bobina = ?, desp_fiscal = ?,
                        desp_frete = ?, desp_custo_fixo = ?, desp_financeira = ?,
                        margem_liquida_valor = ?, margem_liquida_perc = ?
                    WHERE id = ?
                `, [
                    custoAL, custoPE, custoXLPE, custoXLPE_AT, custoHEPR, custoPVC, custoMBUV,
                    CMP, precoSugerido, MB, MBPerc,
                    despComissao, despBobina, despFiscal, despFrete, despCustoFixo, despFinanceira,
                    ML, MLPerc, prod.id
                ]);
                updated++;
            }

            // Update produtos table too
            try {
                await pool.query(`
                    UPDATE produtos p
                    INNER JOIN cabos_composicao cc ON p.codigo COLLATE utf8mb4_unicode_ci = cc.codigo COLLATE utf8mb4_unicode_ci
                    SET p.preco_custo = cc.custo_material_metro,
                        p.custo_unitario = cc.custo_material_metro,
                        p.preco_venda = cc.preco_sugerido
                    WHERE cc.ativo = 1
                `);
            } catch (e) {
                console.log('[ARVORE-PRODUTO] Aviso ao atualizar produtos:', e.message);
            }

            res.json({
                success: true,
                message: `${updated} produtos recalculados com sucesso`,
                total: updated,
                parametros: P
            });
        } catch (error) {
            console.error('[ARVORE-PRODUTO] Erro ao recalcular:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // GET /produtos - List all products with cost breakdown
    // ============================================================
    router.get('/produtos', async (req, res) => {
        try {
            const { search, tipo, order } = req.query;
            let sql = `
                SELECT 
                    cc.id, cc.codigo, cc.descricao, cc.cores, cc.bitola,
                    ROUND(cc.peso_aluminio_kg_m, 6) as peso_al,
                    ROUND(cc.peso_pe_kg_m, 6) as peso_pe,
                    ROUND(cc.peso_xlpe_kg_m, 6) as peso_xlpe,
                    ROUND(cc.peso_xlpe_at_kg_m, 6) as peso_xlpe_at,
                    ROUND(cc.peso_hepr_kg_m, 6) as peso_hepr,
                    ROUND(cc.peso_pvc_kg_m, 6) as peso_pvc,
                    ROUND(cc.peso_total_kg_m, 6) as peso_total,
                    ROUND(cc.custo_aluminio, 4) as custo_al,
                    ROUND(cc.custo_pe, 4) as custo_pe,
                    ROUND(cc.custo_xlpe, 4) as custo_xlpe,
                    ROUND(cc.custo_xlpe_at, 4) as custo_xlpe_at,
                    ROUND(cc.custo_hepr, 4) as custo_hepr,
                    ROUND(cc.custo_pvc, 4) as custo_pvc,
                    ROUND(cc.custo_mbuv, 4) as custo_mbuv,
                    ROUND(cc.custo_material_metro, 4) as cmp,
                    ROUND(cc.preco_sugerido, 4) as preco_sugerido,
                    ROUND(cc.margem_bruta_valor, 4) as mb_valor,
                    ROUND(cc.margem_bruta_perc * 100, 2) as mb_perc,
                    ROUND(cc.desp_comissao, 4) as desp_comissao,
                    ROUND(cc.desp_bobina, 4) as desp_bobina,
                    ROUND(cc.desp_fiscal, 4) as desp_fiscal,
                    ROUND(cc.desp_frete, 4) as desp_frete,
                    ROUND(cc.desp_custo_fixo, 4) as desp_custo_fixo,
                    ROUND(cc.desp_financeira, 4) as desp_financeira,
                    ROUND(cc.margem_liquida_valor, 4) as ml_valor,
                    ROUND(cc.margem_liquida_perc * 100, 2) as ml_perc,
                    p.estoque_atual,
                    p.localizacao
                FROM cabos_composicao cc
                LEFT JOIN produtos p ON p.codigo COLLATE utf8mb4_unicode_ci = cc.codigo COLLATE utf8mb4_unicode_ci
                WHERE cc.ativo = 1
            `;
            const params = [];

            if (search) {
                sql += ' AND (cc.codigo LIKE ? OR cc.descricao LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            if (tipo) {
                if (tipo === 'power') sql += " AND cc.codigo LIKE 'CET%'";
                else if (tipo === 'duplex') sql += " AND (cc.codigo LIKE 'DUI%' OR cc.codigo LIKE 'DUN%')";
                else if (tipo === 'triplex') sql += " AND (cc.codigo LIKE 'TRI%' OR cc.codigo LIKE 'TRN%')";
                else if (tipo === 'quad') sql += " AND (cc.codigo LIKE 'QDI%' OR cc.codigo LIKE 'QDN%')";
                else if (tipo === 'protegido') sql += " AND cc.codigo LIKE 'PRO%'";
                else if (tipo === 'potencia') sql += " AND (cc.codigo LIKE 'POT%' OR cc.codigo LIKE 'UN%')";
            }

            sql += ` ORDER BY ${order === 'preco' ? 'cc.preco_sugerido DESC' : order === 'margem' ? 'cc.margem_liquida_perc DESC' : 'cc.codigo ASC'}`;

            const [rows] = await pool.query(sql, params);
            res.json({ success: true, total: rows.length, produtos: rows });
        } catch (error) {
            console.error('[ARVORE-PRODUTO] Erro ao listar produtos:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // GET /produtos/:id - Get single product detail
    // ============================================================
    router.get('/produtos/:id', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM cabos_composicao WHERE id = ?', [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ success: false, error: 'Produto não encontrado' });

            const [paramRows] = await pool.query('SELECT * FROM arvore_produto_parametros WHERE ativo = 1');
            res.json({ success: true, produto: rows[0], parametros: paramRows });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // GET /resumo - Summary stats
    // ============================================================
    router.get('/resumo', async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT 
                    COUNT(*) as total_produtos,
                    ROUND(AVG(custo_material_metro), 4) as cmp_medio,
                    ROUND(AVG(preco_sugerido), 4) as preco_medio,
                    ROUND(AVG(margem_liquida_perc * 100), 2) as ml_media,
                    ROUND(MIN(preco_sugerido), 4) as preco_min,
                    ROUND(MAX(preco_sugerido), 4) as preco_max,
                    ROUND(MIN(margem_liquida_perc * 100), 2) as ml_min,
                    ROUND(MAX(margem_liquida_perc * 100), 2) as ml_max
                FROM cabos_composicao 
                WHERE ativo = 1 AND custo_material_metro > 0
            `);
            
            const [porTipo] = await pool.query(`
                SELECT 
                    CASE 
                        WHEN codigo LIKE 'CET%' THEN 'Power (CET)'
                        WHEN codigo LIKE 'DUI%' OR codigo LIKE 'DUN%' THEN 'Duplex'
                        WHEN codigo LIKE 'TRI%' OR codigo LIKE 'TRN%' THEN 'Triplex'
                        WHEN codigo LIKE 'QDI%' OR codigo LIKE 'QDN%' THEN 'Quadruplex'
                        WHEN codigo LIKE 'PRO%' THEN 'Protegido'
                        WHEN codigo LIKE 'POT%' OR codigo LIKE 'UN%' THEN 'Potência (UN)'
                        ELSE 'Outros'
                    END as tipo,
                    COUNT(*) as qtd,
                    ROUND(AVG(preco_sugerido), 2) as preco_medio,
                    ROUND(AVG(margem_liquida_perc * 100), 2) as ml_media
                FROM cabos_composicao
                WHERE ativo = 1 AND custo_material_metro > 0
                GROUP BY tipo
                ORDER BY tipo
            `);

            res.json({ success: true, stats: stats[0], por_tipo: porTipo });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // POST /simular - Simulate pricing with custom parameters
    // ============================================================
    router.post('/simular', async (req, res) => {
        try {
            const { produto_id, preco_venda_custom, parametros_custom } = req.body;
            
            const [rows] = await pool.query('SELECT * FROM cabos_composicao WHERE id = ?', [produto_id]);
            if (rows.length === 0) return res.status(404).json({ success: false, error: 'Produto não encontrado' });
            
            const prod = rows[0];
            
            // Get default or custom parameters
            let P = {};
            if (parametros_custom) {
                P = parametros_custom;
            } else {
                const [paramRows] = await pool.query('SELECT nome, valor FROM arvore_produto_parametros WHERE ativo = 1');
                for (const r of paramRows) P[r.nome] = parseFloat(r.valor);
            }

            const custoAL = parseFloat(prod.peso_aluminio_kg_m || 0) * P.preco_aluminio;
            const custoPE = parseFloat(prod.peso_pe_kg_m || 0) * P.preco_pe;
            const custoXLPE = parseFloat(prod.peso_xlpe_kg_m || 0) * P.preco_xlpe;
            const custoXLPE_AT = parseFloat(prod.peso_xlpe_at_kg_m || 0) * P.preco_xlpe_at;
            const custoHEPR = parseFloat(prod.peso_hepr_kg_m || 0) * P.preco_hepr;
            const custoPVC = parseFloat(prod.peso_pvc_kg_m || 0) * P.preco_pvc;
            
            const pesoMBUV = parseFloat(prod.peso_mbuvpt_kg_m || 0) + parseFloat(prod.peso_mbuvcz_kg_m || 0) +
                parseFloat(prod.peso_mbuvvm_kg_m || 0) + parseFloat(prod.peso_mbuvaz_kg_m || 0) +
                parseFloat(prod.peso_mbpeam_kg_m || 0) + parseFloat(prod.peso_mbpevd_kg_m || 0) +
                parseFloat(prod.peso_mbpevm_kg_m || 0) + parseFloat(prod.peso_mbpeaz_kg_m || 0) +
                parseFloat(prod.peso_mbpebc_kg_m || 0) + parseFloat(prod.peso_mbpelj_kg_m || 0) +
                parseFloat(prod.peso_mbpemr_kg_m || 0) + parseFloat(prod.peso_mbpvccz_kg_m || 0) +
                parseFloat(prod.peso_mbpvcpt_kg_m || 0);
            const custoMBUV = pesoMBUV * P.preco_mbuv;

            const CMP = custoAL + custoPE + custoXLPE + custoXLPE_AT + custoHEPR + custoPVC + custoMBUV;
            
            // If custom price, use that; otherwise use markup
            const preco = preco_venda_custom ? parseFloat(preco_venda_custom) : CMP * (1 + (P.markup / 100));
            
            const percComissao = (P.perc_comissao || 1) / 100;
            const percBobina = (P.perc_bobina || 4) / 100;
            const percFiscal = (P.perc_fiscal || 9.62) / 100;
            const percFrete = (P.perc_frete || 1) / 100;
            const percCustoFixo = (P.perc_custo_fixo || 8) / 100;
            const percFinanceira = (P.perc_financeira || 3.68) / 100;

            const despesas = {
                comissao: preco * percComissao,
                bobina: preco * percBobina,
                fiscal: preco * percFiscal,
                frete: preco * percFrete,
                custo_fixo: preco * percCustoFixo,
                financeira: preco * percFinanceira
            };
            const totalDespesas = Object.values(despesas).reduce((a, b) => a + b, 0);

            res.json({
                success: true,
                simulacao: {
                    produto: { codigo: prod.codigo, descricao: prod.descricao },
                    materiais: { aluminio: custoAL, pe: custoPE, xlpe: custoXLPE, xlpe_at: custoXLPE_AT, hepr: custoHEPR, pvc: custoPVC, mbuv: custoMBUV },
                    cmp: CMP,
                    preco_venda: preco,
                    margem_bruta: { valor: preco - CMP, perc: preco > 0 ? ((preco - CMP) / preco * 100) : 0 },
                    despesas,
                    total_despesas: totalDespesas,
                    margem_liquida: { valor: preco - totalDespesas - CMP, perc: preco > 0 ? ((preco - totalDespesas - CMP) / preco * 100) : 0 }
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    console.log('[ROUTES] ✅ Árvore de Produto routes loaded (6 endpoints)');
    return router;
};
