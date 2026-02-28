/**
 * API DE CONCILIAÇÍO BANCÁRIA - ALUFORCE V.2
 * Gerenciamento de conciliação bancária
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/conciliacao-bancaria/contas
 * Lista contas bancárias para conciliação
 */
router.get('/contas', async (req, res) => {
    try {
        const [contas] = await pool.query(`
            SELECT * FROM contas_bancarias 
            WHERE ativo = 1 
            ORDER BY banco, agencia, conta
        `);
        res.json({ success: true, data: contas });
    } catch (error) {
        // Se tabela não existir, retorna exemplo
        res.json({ 
            success: true, 
            data: [],
            message: 'Nenhuma conta bancária cadastrada'
        });
    }
});

/**
 * GET /api/conciliacao-bancaria/extrato/:contaId
 * Busca extrato bancário para conciliação
 */
router.get('/extrato/:contaId', async (req, res) => {
    try {
        const { contaId } = req.params;
        const { data_inicio, data_fim } = req.query;

        let query = `
            SELECT * FROM extrato_bancario 
            WHERE conta_id = ?
        `;
        const params = [contaId];

        if (data_inicio) {
            query += ' AND data >= ?';
            params.push(data_inicio);
        }
        if (data_fim) {
            query += ' AND data <= ?';
            params.push(data_fim);
        }

        query += ' ORDER BY data DESC, id DESC';

        const [extrato] = await pool.query(query, params);
        res.json({ success: true, data: extrato });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * POST /api/conciliacao-bancaria/importar
 * Importa extrato bancário (OFX/CSV)
 */
router.post('/importar', async (req, res) => {
    try {
        const { conta_id, dados, formato = 'json' } = req.body;

        if (!conta_id || !dados) {
            return res.status(400).json({ 
                success: false, 
                error: 'Conta e dados são obrigatórios' 
            });
        }

        let registrosImportados = 0;
        let registrosDuplicados = 0;

        for (const item of dados) {
            try {
                // Verificar duplicidade
                const [existing] = await pool.query(`
                    SELECT id FROM extrato_bancario 
                    WHERE conta_id = ? AND data = ? AND valor = ? AND descricao = ?
                `, [conta_id, item.data, item.valor, item.descricao]);

                if (existing.length === 0) {
                    await pool.query(`
                        INSERT INTO extrato_bancario 
                        (conta_id, data, descricao, valor, tipo, conciliado, created_at)
                        VALUES (?, ?, ?, ?, ?, 0, NOW())
                    `, [
                        conta_id,
                        item.data,
                        item.descricao,
                        item.valor,
                        item.valor >= 0 ? 'credito' : 'debito'
                    ]);
                    registrosImportados++;
                } else {
                    registrosDuplicados++;
                }
            } catch (err) {
                console.warn('[CONCILIAÇÍO] Erro ao importar item:', err.message);
            }
        }

        res.json({ 
            success: true, 
            message: 'Importação concluída',
            data: {
                importados: registrosImportados,
                duplicados: registrosDuplicados
            }
        });
    } catch (error) {
        console.error('[CONCILIAÇÍO] Erro ao importar:', error);
        res.status(500).json({ success: false, error: 'Erro ao importar extrato' });
    }
});

/**
 * POST /api/conciliacao-bancaria/conciliar
 * Concilia lançamento do extrato com movimento financeiro
 */
router.post('/conciliar', async (req, res) => {
    try {
        const { extrato_id, movimento_id, tipo_movimento } = req.body;

        if (!extrato_id || !movimento_id) {
            return res.status(400).json({ 
                success: false, 
                error: 'IDs do extrato e movimento são obrigatórios' 
            });
        }

        // Marcar extrato como conciliado
        await pool.query(`
            UPDATE extrato_bancario 
            SET conciliado = 1, 
                movimento_id = ?,
                tipo_movimento = ?,
                conciliado_em = NOW()
            WHERE id = ?
        `, [movimento_id, tipo_movimento || 'financeiro', extrato_id]);

        res.json({ success: true, message: 'Conciliação realizada com sucesso' });
    } catch (error) {
        console.error('[CONCILIAÇÍO] Erro ao conciliar:', error);
        res.status(500).json({ success: false, error: 'Erro ao conciliar' });
    }
});

/**
 * DELETE /api/conciliacao-bancaria/desconciliar/:id
 * Remove conciliação de um lançamento
 */
router.delete('/desconciliar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(`
            UPDATE extrato_bancario 
            SET conciliado = 0, 
                movimento_id = NULL,
                tipo_movimento = NULL,
                conciliado_em = NULL
            WHERE id = ?
        `, [id]);

        res.json({ success: true, message: 'Conciliação removida' });
    } catch (error) {
        console.error('[CONCILIAÇÍO] Erro ao desconciliar:', error);
        res.status(500).json({ success: false, error: 'Erro ao desconciliar' });
    }
});

/**
 * GET /api/conciliacao-bancaria/pendentes/:contaId
 * Lista lançamentos pendentes de conciliação
 */
router.get('/pendentes/:contaId', async (req, res) => {
    try {
        const { contaId } = req.params;

        const [pendentes] = await pool.query(`
            SELECT * FROM extrato_bancario 
            WHERE conta_id = ? AND conciliado = 0
            ORDER BY data DESC
        `, [contaId]);

        res.json({ success: true, data: pendentes });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/conciliacao-bancaria/sugestoes/:extratoId
 * Sugere movimentos para conciliar com lançamento do extrato
 */
router.get('/sugestoes/:extratoId', async (req, res) => {
    try {
        const { extratoId } = req.params;

        // Buscar lançamento do extrato
        const [extrato] = await pool.query(`
            SELECT * FROM extrato_bancario WHERE id = ?
        `, [extratoId]);

        if (!extrato.length) {
            return res.status(404).json({ success: false, error: 'Lançamento não encontrado' });
        }

        const lancamento = extrato[0];
        const sugestoes = [];

        // Buscar movimentos com valor similar
        if (lancamento.valor > 0) {
            // Crédito - buscar recebimentos
            try {
                const [recebimentos] = await pool.query(`
                    SELECT 
                        id, 'recebimento' as tipo, descricao, valor, data_recebimento as data
                    FROM contas_receber 
                    WHERE valor BETWEEN ? AND ?
                    AND data_recebimento IS NOT NULL
                    AND id NOT IN (
                        SELECT movimento_id FROM extrato_bancario 
                        WHERE movimento_id IS NOT NULL AND tipo_movimento = 'recebimento'
                    )
                    ORDER BY ABS(valor - ?) ASC
                    LIMIT 10
                `, [
                    lancamento.valor * 0.95,
                    lancamento.valor * 1.05,
                    lancamento.valor
                ]);
                sugestoes.push(...recebimentos);
            } catch (e) {}
        } else {
            // Débito - buscar pagamentos
            try {
                const [pagamentos] = await pool.query(`
                    SELECT 
                        id, 'pagamento' as tipo, descricao, valor, data_pagamento as data
                    FROM contas_pagar 
                    WHERE valor BETWEEN ? AND ?
                    AND data_pagamento IS NOT NULL
                    AND id NOT IN (
                        SELECT movimento_id FROM extrato_bancario 
                        WHERE movimento_id IS NOT NULL AND tipo_movimento = 'pagamento'
                    )
                    ORDER BY ABS(valor - ?) ASC
                    LIMIT 10
                `, [
                    Math.abs(lancamento.valor) * 0.95,
                    Math.abs(lancamento.valor) * 1.05,
                    Math.abs(lancamento.valor)
                ]);
                sugestoes.push(...pagamentos);
            } catch (e) {}
        }

        res.json({ success: true, data: sugestoes });
    } catch (error) {
        console.error('[CONCILIAÇÍO] Erro ao buscar sugestões:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar sugestões' });
    }
});

/**
 * GET /api/conciliacao-bancaria/estatisticas/:contaId
 * Estatísticas de conciliação
 */
router.get('/estatisticas/:contaId', async (req, res) => {
    try {
        const { contaId } = req.params;

        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN conciliado = 1 THEN 1 ELSE 0 END) as conciliados,
                SUM(CASE WHEN conciliado = 0 THEN 1 ELSE 0 END) as pendentes,
                SUM(CASE WHEN valor > 0 THEN valor ELSE 0 END) as total_creditos,
                SUM(CASE WHEN valor < 0 THEN ABS(valor) ELSE 0 END) as total_debitos
            FROM extrato_bancario 
            WHERE conta_id = ?
        `, [contaId]);

        res.json({ success: true, data: stats[0] || {} });
    } catch (error) {
        res.json({ 
            success: true, 
            data: { total: 0, conciliados: 0, pendentes: 0 }
        });
    }
});

// Criar tabelas necessárias
async function ensureTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contas_bancarias (
                id INT AUTO_INCREMENT PRIMARY KEY,
                banco VARCHAR(100),
                agencia VARCHAR(20),
                conta VARCHAR(30),
                tipo VARCHAR(50) DEFAULT 'corrente',
                descricao VARCHAR(255),
                saldo_inicial DECIMAL(15,2) DEFAULT 0,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS extrato_bancario (
                id INT AUTO_INCREMENT PRIMARY KEY,
                conta_id INT,
                data DATE,
                descricao VARCHAR(500),
                valor DECIMAL(15,2),
                tipo VARCHAR(20),
                conciliado TINYINT(1) DEFAULT 0,
                movimento_id INT,
                tipo_movimento VARCHAR(50),
                conciliado_em DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conta_id) REFERENCES contas_bancarias(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        console.log('[CONCILIAÇÍO] ✅ Tabelas verificadas/criadas');
    } catch (error) {
        console.error('[CONCILIAÇÍO] Erro ao criar tabelas:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    ensureTables();
    return router;
};
