/**
 * API INTEGRAÇÍO VENDAS-FINANCEIRO - ALUFORCE V.2
 * Integração entre módulos de Vendas e Financeiro
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * POST /api/integracao-vendas-financeiro/gerar-financeiro
 * Gera contas a receber a partir de um pedido
 */
router.post('/gerar-financeiro', async (req, res) => {
    try {
        const { pedido_id, parcelas = 1, primeiro_vencimento, intervalo_dias = 30 } = req.body;

        if (!pedido_id) {
            return res.status(400).json({ success: false, error: 'ID do pedido é obrigatório' });
        }

        // Buscar pedido
        const [pedidos] = await pool.query(`
            SELECT p.*, c.razao_social, c.nome_fantasia 
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.id = ?
        `, [pedido_id]);

        if (!pedidos.length) {
            return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
        }

        const pedido = pedidos[0];
        const valorParcela = pedido.valor_total / parcelas;
        const dataBase = primeiro_vencimento ? new Date(primeiro_vencimento) : new Date();
        const contasCriadas = [];

        for (let i = 0; i < parcelas; i++) {
            const dataVencimento = new Date(dataBase);
            dataVencimento.setDate(dataVencimento.getDate() + (i * intervalo_dias));

            const [result] = await pool.query(`
                INSERT INTO contas_receber (
                    pedido_id, cliente_id, descricao, valor, data_vencimento,
                    parcela, total_parcelas, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', NOW())
            `, [
                pedido_id,
                pedido.cliente_id,
                `Pedido #${pedido.numero || pedido_id} - Parcela ${i + 1}/${parcelas}`,
                valorParcela.toFixed(2),
                dataVencimento.toISOString().slice(0, 10),
                i + 1,
                parcelas
            ]);

            contasCriadas.push({ id: result.insertId, parcela: i + 1, valor: valorParcela });
        }

        // Atualizar pedido
        await pool.query(`
            UPDATE pedidos SET financeiro_gerado = 1 WHERE id = ?
        `, [pedido_id]).catch(() => {});

        res.json({ 
            success: true, 
            message: `${parcelas} parcela(s) gerada(s) com sucesso`,
            data: contasCriadas
        });
    } catch (error) {
        console.error('[INTEGRAÇÍO V-F] Erro ao gerar financeiro:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar financeiro' });
    }
});

/**
 * GET /api/integracao-vendas-financeiro/pedido/:id
 * Busca dados financeiros de um pedido
 */
router.get('/pedido/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [contas] = await pool.query(`
            SELECT * FROM contas_receber WHERE pedido_id = ? ORDER BY parcela
        `, [id]);

        const resumo = {
            total_parcelas: contas.length,
            valor_total: contas.reduce((s, c) => s + parseFloat(c.valor || 0), 0),
            valor_pago: contas.filter(c => c.status === 'pago').reduce((s, c) => s + parseFloat(c.valor || 0), 0),
            valor_pendente: contas.filter(c => c.status === 'pendente').reduce((s, c) => s + parseFloat(c.valor || 0), 0),
            parcelas_pagas: contas.filter(c => c.status === 'pago').length,
            parcelas_pendentes: contas.filter(c => c.status === 'pendente').length
        };

        res.json({ success: true, data: { contas, resumo } });
    } catch (error) {
        res.json({ success: true, data: { contas: [], resumo: {} } });
    }
});

/**
 * POST /api/integracao-vendas-financeiro/sincronizar
 * Sincroniza status entre vendas e financeiro
 */
router.post('/sincronizar', async (req, res) => {
    try {
        let atualizados = 0;

        // Buscar pedidos com financeiro gerado
        const [pedidos] = await pool.query(`
            SELECT DISTINCT pedido_id FROM contas_receber WHERE pedido_id IS NOT NULL
        `);

        for (const p of pedidos) {
            const [contas] = await pool.query(`
                SELECT status FROM contas_receber WHERE pedido_id = ?
            `, [p.pedido_id]);

            const todasPagas = contas.every(c => c.status === 'pago');
            if (todasPagas && contas.length > 0) {
                await pool.query(`
                    UPDATE pedidos SET status_financeiro = 'quitado' WHERE id = ?
                `, [p.pedido_id]).catch(() => {});
                atualizados++;
            }
        }

        res.json({ success: true, message: `${atualizados} pedido(s) atualizado(s)` });
    } catch (error) {
        console.error('[INTEGRAÇÍO V-F] Erro ao sincronizar:', error);
        res.status(500).json({ success: false, error: 'Erro ao sincronizar' });
    }
});

/**
 * GET /api/integracao-vendas-financeiro/pendentes
 * Lista pedidos sem financeiro gerado
 */
router.get('/pendentes', async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT p.*, c.razao_social, c.nome_fantasia
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.status NOT IN ('cancelado', 'orcamento')
            AND (p.financeiro_gerado = 0 OR p.financeiro_gerado IS NULL)
            AND p.id NOT IN (SELECT DISTINCT pedido_id FROM contas_receber WHERE pedido_id IS NOT NULL)
            ORDER BY p.created_at DESC
        `);

        res.json({ success: true, data: pedidos });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    return router;
};
