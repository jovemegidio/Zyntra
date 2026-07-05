/**
 * Rotas de API para RH - Requisições de Compra
 * Extracted from modules/RH/server.js to be served on the main server
 */

const express = require('express');

module.exports = function createRHRequisicoesCompraRoutes(deps) {
    const { pool, authenticateToken } = deps;
    const router = express.Router();

    // Auto-create tables
    (async () => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS rh_requisicoes_compra (
                id INT AUTO_INCREMENT PRIMARY KEY,
                numero_requisicao VARCHAR(20) DEFAULT NULL,
                solicitante VARCHAR(255) NOT NULL,
                departamento VARCHAR(100) DEFAULT NULL,
                data_pedido DATE DEFAULT NULL,
                data_necessaria DATE NOT NULL,
                prioridade ENUM('baixa','normal','alta','urgente') DEFAULT 'normal',
                observacoes TEXT DEFAULT NULL,
                status ENUM('pendente','aprovada','em_cotacao','concluida','cancelada') DEFAULT 'pendente',
                valor_total DECIMAL(12,2) DEFAULT 0.00,
                criado_por INT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

            await pool.query(`CREATE TABLE IF NOT EXISTS rh_requisicoes_compra_itens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                requisicao_id INT NOT NULL,
                descricao VARCHAR(500) NOT NULL,
                quantidade DECIMAL(10,3) NOT NULL DEFAULT 1,
                unidade VARCHAR(20) DEFAULT 'UN',
                preco_unitario DECIMAL(12,2) DEFAULT 0.00,
                preco_total DECIMAL(12,2) DEFAULT 0.00,
                FOREIGN KEY (requisicao_id) REFERENCES rh_requisicoes_compra(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        } catch (e) {
            console.error('[RH-REQUISICOES] Erro ao criar tabelas:', e.message);
        }
    })();

    // GET /api/rh/requisicoes-compra — listar todas
    router.get('/requisicoes-compra', authenticateToken, async (req, res) => {
        try {
            const [requisicoes] = await pool.query(`
                SELECT r.*, pc.numero_pedido AS numero_pedido_compras
                FROM rh_requisicoes_compra r
                LEFT JOIN pedidos_compra pc ON pc.origem = 'RH' AND pc.ordem_compra_pcp_id = r.id
                ORDER BY r.created_at DESC
            `);
            res.json({ requisicoes });
        } catch (err) {
            console.error('[RH-REQUISICOES] Erro ao listar:', err);
            res.status(500).json({ error: 'Erro ao listar requisições' });
        }
    });

    // GET /api/rh/requisicoes-compra/:id — detalhes com itens
    router.get('/requisicoes-compra/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT r.*, pc.numero_pedido AS numero_pedido_compras
                 FROM rh_requisicoes_compra r
                 LEFT JOIN pedidos_compra pc ON pc.origem = 'RH' AND pc.ordem_compra_pcp_id = r.id
                 WHERE r.id = ?`,
                [id]
            );
            if (!rows.length) return res.status(404).json({ error: 'Requisição não encontrada' });
            const [itens] = await pool.query(
                'SELECT * FROM rh_requisicoes_compra_itens WHERE requisicao_id = ? ORDER BY id',
                [id]
            );
            res.json({ ...rows[0], itens });
        } catch (err) {
            console.error('[RH-REQUISICOES] Erro ao buscar requisição:', err);
            res.status(500).json({ error: 'Erro ao buscar requisição' });
        }
    });

    // POST /api/rh/requisicoes-compra — criar
    router.post('/requisicoes-compra', authenticateToken, async (req, res) => {
        const { solicitante, departamento, data_necessaria, prioridade, observacoes, itens } = req.body;

        if (!solicitante) return res.status(400).json({ error: 'Solicitante é obrigatório' });
        if (!data_necessaria) return res.status(400).json({ error: 'Data necessária é obrigatória' });
        if (!Array.isArray(itens) || !itens.length) return res.status(400).json({ error: 'Informe ao menos um item' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [resultReq] = await conn.query(`
                INSERT INTO rh_requisicoes_compra
                    (solicitante, departamento, data_necessaria, prioridade, observacoes, status, data_pedido, criado_por)
                VALUES (?, ?, ?, ?, ?, 'pendente', CURDATE(), ?)`,
                [solicitante, departamento || null, data_necessaria, prioridade || 'normal', observacoes || null, req.user && req.user.id || null]
            );
            const reqId = resultReq.insertId;

            const numero = 'RQ-RH-' + String(reqId).padStart(6, '0');
            await conn.query('UPDATE rh_requisicoes_compra SET numero_requisicao = ? WHERE id = ?', [numero, reqId]);

            let valorTotal = 0;
            for (const it of itens) {
                const preco = parseFloat(it.preco_unitario) || 0;
                const qtd = parseFloat(it.quantidade) || 0;
                const sub = preco * qtd;
                valorTotal += sub;
                await conn.query(`
                    INSERT INTO rh_requisicoes_compra_itens
                        (requisicao_id, descricao, quantidade, unidade, preco_unitario, preco_total)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [reqId, it.descricao, qtd, it.unidade || 'UN', preco, sub]
                );
            }

            await conn.query('UPDATE rh_requisicoes_compra SET valor_total = ? WHERE id = ?', [valorTotal, reqId]);

            // Integração com módulo Compras
            const [resultPedido] = await conn.query(`
                INSERT INTO pedidos_compra
                    (numero_pedido, data_pedido, data_entrega_prevista, valor_total, valor_final,
                     observacoes, status, origem, ordem_compra_pcp_id)
                VALUES (?, CURDATE(), ?, ?, ?, ?, 'aguardando_cotacao', 'RH', ?)`,
                [numero, data_necessaria, valorTotal, valorTotal,
                 `[RH - ${departamento || 'N/A'}] ${observacoes || 'Sem observações'}`, reqId]
            );
            const pedidoId = resultPedido.insertId;

            for (const it of itens) {
                const preco = parseFloat(it.preco_unitario) || 0;
                const qtd = parseFloat(it.quantidade) || 0;
                await conn.query(`
                    INSERT INTO itens_pedido
                        (pedido_id, codigo_produto, descricao, quantidade, unidade, preco_unitario, preco_total, observacoes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [pedidoId, `RH-${reqId}`, it.descricao, qtd, it.unidade || 'UN', preco, preco * qtd, solicitante]
                );
            }

            await conn.commit();
            res.status(201).json({ success: true, id: reqId, numero_requisicao: numero });
        } catch (err) {
            await conn.rollback();
            console.error('[RH-REQUISICOES] Erro ao criar requisição:', err);
            res.status(500).json({ error: 'Erro ao criar requisição' });
        } finally {
            conn.release();
        }
    });

    // PUT /api/rh/requisicoes-compra/:id/cancelar
    router.put('/requisicoes-compra/:id/cancelar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query(
                "UPDATE rh_requisicoes_compra SET status = 'cancelado' WHERE id = ? AND status = 'pendente'",
                [id]
            );
            await pool.query(
                "UPDATE pedidos_compra SET status = 'cancelado' WHERE origem = 'RH' AND ordem_compra_pcp_id = ?",
                [id]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('[RH-REQUISICOES] Erro ao cancelar requisição:', err);
            res.status(500).json({ error: 'Erro ao cancelar' });
        }
    });

    return router;
};
