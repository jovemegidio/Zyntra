/**
 * API INTEGRAÇÍO COMPRAS-FINANCEIRO - ALUFORCE V.2
 * Integração entre módulos de Compras e Financeiro
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * POST /api/integracao-compras-financeiro/gerar-financeiro
 * Gera contas a pagar a partir de uma ordem de compra
 */
router.post('/gerar-financeiro', async (req, res) => {
    try {
        const { ordem_compra_id, parcelas = 1, primeiro_vencimento, intervalo_dias = 30 } = req.body;

        if (!ordem_compra_id) {
            return res.status(400).json({ success: false, error: 'ID da ordem de compra é obrigatório' });
        }

        // Buscar ordem de compra
        const [ordens] = await pool.query(`
            SELECT oc.*, f.razao_social as fornecedor_nome
            FROM ordens_compra oc
            LEFT JOIN fornecedores f ON oc.fornecedor_id = f.id
            WHERE oc.id = ?
        `, [ordem_compra_id]);

        if (!ordens.length) {
            return res.status(404).json({ success: false, error: 'Ordem de compra não encontrada' });
        }

        const ordem = ordens[0];
        const valorParcela = ordem.valor_total / parcelas;
        const dataBase = primeiro_vencimento ? new Date(primeiro_vencimento) : new Date();
        const contasCriadas = [];

        for (let i = 0; i < parcelas; i++) {
            const dataVencimento = new Date(dataBase);
            dataVencimento.setDate(dataVencimento.getDate() + (i * intervalo_dias));

            const [result] = await pool.query(`
                INSERT INTO contas_pagar (
                    ordem_compra_id, fornecedor_id, descricao, valor, data_vencimento,
                    parcela, total_parcelas, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', NOW())
            `, [
                ordem_compra_id,
                ordem.fornecedor_id,
                `OC #${ordem.numero || ordem_compra_id} - Parcela ${i + 1}/${parcelas}`,
                valorParcela.toFixed(2),
                dataVencimento.toISOString().slice(0, 10),
                i + 1,
                parcelas
            ]);

            contasCriadas.push({ id: result.insertId, parcela: i + 1, valor: valorParcela });
        }

        // Atualizar ordem de compra
        await pool.query(`
            UPDATE ordens_compra SET financeiro_gerado = 1 WHERE id = ?
        `, [ordem_compra_id]).catch(() => {});

        res.json({ 
            success: true, 
            message: `${parcelas} parcela(s) gerada(s) com sucesso`,
            data: contasCriadas
        });
    } catch (error) {
        console.error('[INTEGRAÇÍO C-F] Erro ao gerar financeiro:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar financeiro' });
    }
});

/**
 * POST /api/integracao-compras-financeiro/pedido/gerar-financeiro
 * Gera contas a pagar a partir de um pedido de compra (tabela pedidos_compra)
 */
router.post('/pedido/gerar-financeiro', async (req, res) => {
    try {
        const { pedido_id, parcelas = 1, primeiro_vencimento, intervalo_dias = 30 } = req.body;

        if (!pedido_id) {
            return res.status(400).json({ success: false, error: 'ID do pedido de compra é obrigatório' });
        }

        // Verificar se já existe conta para este pedido
        const [existente] = await pool.query(`
            SELECT id FROM contas_pagar WHERE descricao LIKE ? LIMIT 1
        `, [`%Pedido Compra #${pedido_id}%`]);
        
        if (existente.length > 0) {
            return res.status(400).json({ success: false, error: 'Já existe conta a pagar para este pedido' });
        }

        // Buscar pedido de compra
        const [pedidos] = await pool.query(`
            SELECT pc.*, f.razao_social as fornecedor_nome
            FROM pedidos_compra pc
            LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
            WHERE pc.id = ?
        `, [pedido_id]);

        if (!pedidos.length) {
            return res.status(404).json({ success: false, error: 'Pedido de compra não encontrado' });
        }

        const pedido = pedidos[0];
        
        if (!['aprovado', 'recebido'].includes(pedido.status)) {
            return res.status(400).json({ success: false, error: 'Pedido precisa estar aprovado ou recebido' });
        }
        
        const valorTotal = parseFloat(pedido.valor_final) || parseFloat(pedido.valor_total) || 0;
        const valorParcela = valorTotal / parcelas;
        const dataBase = primeiro_vencimento ? new Date(primeiro_vencimento) : new Date();
        const contasCriadas = [];

        for (let i = 0; i < parcelas; i++) {
            const dataVencimento = new Date(dataBase);
            dataVencimento.setDate(dataVencimento.getDate() + (i * intervalo_dias));

            const [result] = await pool.query(`
                INSERT INTO contas_pagar (
                    fornecedor_id, descricao, valor, data_vencimento, vencimento,
                    status, data_criacao
                ) VALUES (?, ?, ?, ?, ?, 'pendente', NOW())
            `, [
                pedido.fornecedor_id,
                `Pedido Compra #${pedido.id} - ${pedido.numero_pedido}${parcelas > 1 ? ` - Parcela ${i + 1}/${parcelas}` : ''}`,
                valorParcela.toFixed(2),
                dataVencimento.toISOString().slice(0, 10),
                dataVencimento.toISOString().slice(0, 10)
            ]);

            contasCriadas.push({ id: result.insertId, parcela: i + 1, valor: valorParcela });
        }

        // Registrar atividade
        await pool.query(`
            INSERT INTO compras_atividades (tipo, descricao, created_at) 
            VALUES ('financeiro', ?, NOW())
        `, [`Conta a pagar gerada para pedido ${pedido.numero_pedido} - R$ ${valorTotal.toFixed(2)}`]).catch(() => {});

        res.json({ 
            success: true, 
            message: `${parcelas} parcela(s) gerada(s) com sucesso para pedido ${pedido.numero_pedido}`,
            data: contasCriadas,
            valor_total: valorTotal
        });
    } catch (error) {
        console.error('[INTEGRAÇÍO C-F] Erro ao gerar financeiro de pedido:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar financeiro' });
    }
});

/**
 * GET /api/integracao-compras-financeiro/pedidos-pendentes
 * Lista pedidos de compra aprovados/recebidos sem financeiro gerado
 */
router.get('/pedidos-pendentes', async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT 
                pc.id, pc.numero_pedido, pc.status, pc.valor_total, pc.valor_final,
                pc.data_pedido, pc.data_entrega_prevista, pc.data_recebimento,
                f.razao_social as fornecedor_nome, f.nome_fantasia as fornecedor_fantasia
            FROM pedidos_compra pc
            LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
            WHERE pc.status IN ('aprovado', 'recebido')
            AND pc.id NOT IN (
                SELECT DISTINCT CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(descricao, '#', -1), ' ', 1) AS UNSIGNED)
                FROM contas_pagar 
                WHERE descricao LIKE '%Pedido Compra #%'
            )
            ORDER BY pc.created_at DESC
        `);

        res.json({ success: true, data: pedidos });
    } catch (error) {
        console.error('[INTEGRAÇÍO C-F] Erro ao buscar pedidos pendentes:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/integracao-compras-financeiro/ordem/:id
 * Busca dados financeiros de uma ordem de compra
 */
router.get('/ordem/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [contas] = await pool.query(`
            SELECT * FROM contas_pagar WHERE ordem_compra_id = ? ORDER BY parcela
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
 * POST /api/integracao-compras-financeiro/sincronizar
 * Sincroniza status entre compras e financeiro
 */
router.post('/sincronizar', async (req, res) => {
    try {
        let atualizados = 0;

        // Buscar ordens com financeiro gerado
        const [ordens] = await pool.query(`
            SELECT DISTINCT ordem_compra_id FROM contas_pagar WHERE ordem_compra_id IS NOT NULL
        `);

        for (const o of ordens) {
            const [contas] = await pool.query(`
                SELECT status FROM contas_pagar WHERE ordem_compra_id = ?
            `, [o.ordem_compra_id]);

            const todasPagas = contas.every(c => c.status === 'pago');
            if (todasPagas && contas.length > 0) {
                await pool.query(`
                    UPDATE ordens_compra SET status_financeiro = 'quitado' WHERE id = ?
                `, [o.ordem_compra_id]).catch(() => {});
                atualizados++;
            }
        }

        res.json({ success: true, message: `${atualizados} ordem(ns) atualizada(s)` });
    } catch (error) {
        console.error('[INTEGRAÇÍO C-F] Erro ao sincronizar:', error);
        res.status(500).json({ success: false, error: 'Erro ao sincronizar' });
    }
});

/**
 * GET /api/integracao-compras-financeiro/pendentes
 * Lista ordens de compra sem financeiro gerado
 */
router.get('/pendentes', async (req, res) => {
    try {
        const [ordens] = await pool.query(`
            SELECT oc.*, f.razao_social as fornecedor_nome
            FROM ordens_compra oc
            LEFT JOIN fornecedores f ON oc.fornecedor_id = f.id
            WHERE oc.status NOT IN ('cancelada', 'cotacao')
            AND (oc.financeiro_gerado = 0 OR oc.financeiro_gerado IS NULL)
            AND oc.id NOT IN (SELECT DISTINCT ordem_compra_id FROM contas_pagar WHERE ordem_compra_id IS NOT NULL)
            ORDER BY oc.created_at DESC
        `);

        res.json({ success: true, data: ordens });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/integracao-compras-financeiro/fornecedor/:id/resumo
 * Resumo financeiro de um fornecedor
 */
router.get('/fornecedor/:id/resumo', async (req, res) => {
    try {
        const { id } = req.params;

        const [resumo] = await pool.query(`
            SELECT 
                COUNT(*) as total_contas,
                COALESCE(SUM(valor), 0) as valor_total,
                COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END), 0) as valor_pago,
                COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as valor_pendente,
                COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento < CURDATE() THEN valor ELSE 0 END), 0) as valor_vencido
            FROM contas_pagar 
            WHERE fornecedor_id = ?
        `, [id]);

        res.json({ success: true, data: resumo[0] || {} });
    } catch (error) {
        res.json({ success: true, data: {} });
    }
});

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    return router;
};
