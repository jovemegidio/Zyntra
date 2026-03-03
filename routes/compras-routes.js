/**
 * COMPRAS ROUTES (PART 1) - Rotas complementares (recebimento, relat??rios, centros de custo)
 * NOTA: Dashboard, fornecedores e pedidos CRUD est??o em compras-extended.js
 * @module routes/compras-routes
 */
const express = require('express');

module.exports = function createComprasRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, writeAuditLog } = deps;
    const router = express.Router();

    router.use(authenticateToken);
    router.use(authorizeArea('compras'));

    // ===================== RELAT??RIOS DE COMPRAS =====================

    // Relat??rio de gastos por per??odo
    router.get('/relatorios/gastos-periodo', async (req, res, next) => {
        try {
            const { data_inicio, data_fim, fornecedor_id } = req.query;

            let whereClause = 'WHERE pc.status = "aprovado"';
            const params = [];

            if (data_inicio && data_fim) {
                whereClause += ' AND pc.data_pedido BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }

            if (fornecedor_id) {
                whereClause += ' AND pc.fornecedor_id = ?';
                params.push(fornecedor_id);
            }

            const [gastos] = await pool.query(`
                SELECT
                    COALESCE(f.razao_social, f.nome) as fornecedor,
                    COUNT(pc.id) as total_pedidos,
                    SUM(pc.valor_total) as total_gasto,
                    AVG(pc.valor_total) as ticket_medio
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                ${whereClause}
                GROUP BY pc.fornecedor_id, f.razao_social, f.nome
                ORDER BY total_gasto DESC
            `, params);

            res.json({
                success: true,
                data: { gastos }
            });
        } catch (error) {
            next(error);
        }
    });

    // ===================== ROTAS DE RECEBIMENTO =====================

    // Estat??sticas de Recebimento
    router.get('/recebimento/stats', async (req, res, next) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];

            const [pendentes] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
            `);

            const [atrasados] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
                AND data_entrega_prevista < ?
            `, [hoje]);

            const [recebidosHoje] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE DATE(data_recebimento) = ?
            `, [hoje]);

            const [valorPendente] = await pool.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
            `);

            res.json({
                pendentes: pendentes[0].total || 0,
                atrasados: atrasados[0].total || 0,
                recebidos_hoje: recebidosHoje[0].total || 0,
                valor_pendente: valorPendente[0].total || 0
            });
        } catch (error) {
            console.error('Erro ao buscar estat??sticas de recebimento:', error);
            next(error);
        }
    });

    // Listar Pedidos para Recebimento
    router.get('/recebimento/pedidos', async (req, res, next) => {
        try {
            const { status = 'pendente', limit = 50, offset = 0, busca } = req.query;
            const hoje = new Date().toISOString().split('T')[0];

            let sql = `
                SELECT pc.*, COALESCE(f.razao_social, f.nome) as fornecedor_nome
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                WHERE 1=1
            `;
            const params = [];

            if (status === 'pendente') {
                sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL`;
            } else if (status === 'atrasado') {
                sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL
                         AND pc.data_entrega_prevista < ?`;
                params.push(hoje);
            } else if (status === 'recebido') {
                sql += ` AND pc.status = 'recebido'`;
            } else if (status === 'parcial') {
                sql += ` AND pc.status = 'parcial'`;
            }

            if (busca) {
                sql += ` AND (pc.numero_pedido LIKE ? OR f.razao_social LIKE ? OR pc.numero_nfe LIKE ?)`;
                const buscaTerm = `%${busca}%`;
                params.push(buscaTerm, buscaTerm, buscaTerm);
            }

            sql += ` ORDER BY
                CASE WHEN pc.data_entrega_prevista < ? AND pc.status != 'recebido' THEN 0 ELSE 1 END,
                pc.data_entrega_prevista ASC, pc.data_pedido DESC
            `;
            params.push(hoje);

            // Count total
            const countSql = sql.replace(/SELECT pc\.\*, COALESCE\(f\.razao_social, f\.nome\) as fornecedor_nome/i, 'SELECT COUNT(*) as total');
            const [countResult] = await pool.query(countSql, params);
            const total = countResult[0].total;

            sql += ` LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));

            const [pedidos] = await pool.query(sql, params);

            res.json({
                pedidos,
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('Erro ao listar pedidos para recebimento:', error);
            next(error);
        }
    });

    // Centros de Custo
    router.get('/centros-custo', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT id, nome FROM centros_custo WHERE ativo = 1 ORDER BY nome');
            res.json(rows);
        } catch (error) {
            res.json([{ id: 1, nome: 'Vendas' }, { id: 2, nome: 'Marketing' }, { id: 3, nome: 'Produ????o' }, { id: 4, nome: 'Administrativo' }]);
        }
    });

    return router;
};

