/**
 * API DE NOTIFICAÇÕES - ALUFORCE V.2
 * Sistema de notificações em tempo real
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/notificacoes
 * Lista notificações do usuário
 */
router.get('/', async (req, res) => {
    try {
        const usuario_id = req.query.usuario_id || req.user?.id;
        const { lidas = 'todas', limite = 50 } = req.query;

        let query = `
            SELECT id, usuario_id, tipo, titulo, mensagem, lida, referencia_tipo, referencia_id, created_at
            FROM notificacoes
            WHERE usuario_id = ?
        `;
        const params = [usuario_id];

        if (lidas === 'nao') {
            query += ' AND lida = 0';
        } else if (lidas === 'sim') {
            query += ' AND lida = 1';
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limite));

        const [notificacoes] = await pool.query(query, params);
        res.json({ success: true, data: notificacoes });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/notificacoes/alertas
 * Retorna alertas dos módulos do sistema (contas vencidas, pedidos pendentes, etc.)
 */
router.get('/alertas', async (req, res) => {
    try {
        const alertas = [];

        // Alertas de contas a receber vencidas
        try {
            const [vencidas] = await pool.query(`
                SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor_total
                FROM contas_receber
                WHERE status = 'pendente' AND vencimento < CURDATE()
            `);
            if (vencidas[0]?.total > 0) {
                alertas.push({
                    modulo: 'financeiro',
                    titulo: `${vencidas[0].total} conta(s) a receber vencida(s)`,
                    mensagem: `Valor total: R$ ${Number(vencidas[0].valor_total).toFixed(2).replace('.', ',')}`,
                    tipo: 'danger',
                    link: '/modules/Financeiro/contas-receber.html',
                    icone: 'exclamation-triangle'
                });
            }
        } catch (e) { /* tabela pode não existir */ }

        // Alertas de contas a pagar vencidas
        try {
            const [vencidas] = await pool.query(`
                SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor_total
                FROM contas_pagar
                WHERE status = 'pendente' AND vencimento < CURDATE()
            `);
            if (vencidas[0]?.total > 0) {
                alertas.push({
                    modulo: 'financeiro',
                    titulo: `${vencidas[0].total} conta(s) a pagar vencida(s)`,
                    mensagem: `Valor total: R$ ${Number(vencidas[0].valor_total).toFixed(2).replace('.', ',')}`,
                    tipo: 'danger',
                    link: '/modules/Financeiro/contas-pagar.html',
                    icone: 'exclamation-triangle'
                });
            }
        } catch (e) { /* tabela pode não existir */ }

        // Alertas de contas vencendo em 7 dias
        try {
            const [vencendo] = await pool.query(`
                SELECT COUNT(*) as total
                FROM contas_pagar
                WHERE status = 'pendente' AND vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            `);
            if (vencendo[0]?.total > 0) {
                alertas.push({
                    modulo: 'financeiro',
                    titulo: `${vencendo[0].total} conta(s) vencendo em 7 dias`,
                    mensagem: 'Verifique as contas a pagar próximas do vencimento',
                    tipo: 'warning',
                    link: '/modules/Financeiro/contas-pagar.html',
                    icone: 'clock'
                });
            }
        } catch (e) { /* tabela pode não existir */ }

        res.json({ success: true, alertas });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao carregar alertas:', error);
        res.json({ success: true, alertas: [] });
    }
});

/**
 * GET /api/notificacoes/nao-lidas
 * Conta notificações não lidas
 */
router.get('/nao-lidas', async (req, res) => {
    try {
        const usuario_id = req.query.usuario_id || req.user?.id;

        const [result] = await pool.query(`
            SELECT COUNT(*) as total FROM notificacoes
            WHERE usuario_id = ? AND lida = 0
        `, [usuario_id]);

        res.json({ success: true, data: { total: result[0]?.total || 0 } });
    } catch (error) {
        res.json({ success: true, data: { total: 0 } });
    }
});

/**
 * POST /api/notificacoes
 * Cria nova notificação
 */
router.post('/', async (req, res) => {
    try {
        const {
            usuario_id,
            titulo,
            mensagem,
            tipo = 'info',
            link,
            dados_extras
        } = req.body;

        if (!usuario_id || !titulo) {
            return res.status(400).json({
                success: false,
                error: 'Usuário e título são obrigatórios'
            });
        }

        const [result] = await pool.query(`
            INSERT INTO notificacoes (
                usuario_id, titulo, mensagem, tipo, link, dados_extras,
                lida, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
        `, [
            usuario_id,
            titulo,
            mensagem,
            tipo,
            link,
            dados_extras ? JSON.stringify(dados_extras) : null
        ]);

        res.json({
            success: true,
            message: 'Notificação criada',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao criar:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar notificação' });
    }
});

/**
 * POST /api/notificacoes/broadcast
 * Envia notificação para múltiplos usuários
 */
router.post('/broadcast', async (req, res) => {
    try {
        const {
            usuario_ids,
            role,
            todos = false,
            titulo,
            mensagem,
            tipo = 'info',
            link
        } = req.body;

        if (!titulo) {
            return res.status(400).json({ success: false, error: 'Título é obrigatório' });
        }

        let usuarios = [];

        if (todos) {
            const [result] = await pool.query(`SELECT id FROM usuarios WHERE ativo = 1`);
            usuarios = result.map(u => u.id);
        } else if (role) {
            const [result] = await pool.query(`SELECT id FROM usuarios WHERE role = ? AND ativo = 1`, [role]);
            usuarios = result.map(u => u.id);
        } else if (usuario_ids && Array.isArray(usuario_ids)) {
            usuarios = usuario_ids;
        }

        let criadas = 0;
        for (const uid of usuarios) {
            try {
                await pool.query(`
                    INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, link, lida, created_at)
                    VALUES (?, ?, ?, ?, ?, 0, NOW())
                `, [uid, titulo, mensagem, tipo, link]);
                criadas++;
            } catch (e) {}
        }

        res.json({ success: true, message: `${criadas} notificação(ões) enviada(s)` });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro no broadcast:', error);
        res.status(500).json({ success: false, error: 'Erro ao enviar notificações' });
    }
});

/**
 * PUT /api/notificacoes/:id/lida
 * Marca notificação como lida
 */
router.put('/:id/lida', async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(`
            UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE id = ?
        `, [id]);

        res.json({ success: true, message: 'Notificação marcada como lida' });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao marcar como lida:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar notificação' });
    }
});

/**
 * PUT /api/notificacoes/marcar-todas-lidas
 * Marca todas as notificações do usuário como lidas
 */
router.put('/marcar-todas-lidas', async (req, res) => {
    try {
        const usuario_id = req.body.usuario_id || req.user?.id;

        const [result] = await pool.query(`
            UPDATE notificacoes SET lida = 1, lida_em = NOW()
            WHERE usuario_id = ? AND lida = 0
        `, [usuario_id]);

        res.json({
            success: true,
            message: `${result.affectedRows} notificação(ões) marcada(s) como lida(s)`
        });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao marcar todas como lidas:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar notificações' });
    }
});

/**
 * DELETE /api/notificacoes/:id
 * Remove uma notificação
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(`DELETE FROM notificacoes WHERE id = ?`, [id]);

        res.json({ success: true, message: 'Notificação removida' });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao remover:', error);
        res.status(500).json({ success: false, error: 'Erro ao remover notificação' });
    }
});

/**
 * DELETE /api/notificacoes/limpar
 * Remove notificações antigas
 */
router.delete('/limpar', async (req, res) => {
    try {
        const { dias = 30 } = req.query;
        const usuario_id = req.body.usuario_id || req.user?.id;

        const [result] = await pool.query(`
            DELETE FROM notificacoes
            WHERE usuario_id = ? AND lida = 1 AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [usuario_id, parseInt(dias)]);

        res.json({ success: true, message: `${result.affectedRows} notificação(ões) removida(s)` });
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao limpar:', error);
        res.status(500).json({ success: false, error: 'Erro ao limpar notificações' });
    }
});

/**
 * GET /api/notificacoes/tipos
 * Lista tipos de notificação disponíveis
 */
router.get('/tipos', async (req, res) => {
    res.json({
        success: true,
        data: [
            { codigo: 'info', nome: 'Informação', icone: 'info', cor: '#3498db' },
            { codigo: 'sucesso', nome: 'Sucesso', icone: 'check-circle', cor: '#27ae60' },
            { codigo: 'aviso', nome: 'Aviso', icone: 'exclamation-triangle', cor: '#f39c12' },
            { codigo: 'erro', nome: 'Erro', icone: 'times-circle', cor: '#e74c3c' },
            { codigo: 'tarefa', nome: 'Tarefa', icone: 'tasks', cor: '#9b59b6' },
            { codigo: 'pedido', nome: 'Pedido', icone: 'shopping-cart', cor: '#1abc9c' },
            { codigo: 'producao', nome: 'Produção', icone: 'industry', cor: '#34495e' },
            { codigo: 'financeiro', nome: 'Financeiro', icone: 'dollar-sign', cor: '#2ecc71' }
        ]
    });
});

// Criar tabela de notificações se não existir
async function ensureTable() {
    if (!pool) {
        console.warn('[NOTIFICAÇÕES] Pool não disponível ainda, tabela será criada depois');
        return;
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT NOT NULL,
                titulo VARCHAR(255) NOT NULL,
                mensagem TEXT,
                tipo VARCHAR(50) DEFAULT 'info',
                link VARCHAR(500),
                dados_extras JSON,
                lida TINYINT(1) DEFAULT 0,
                lida_em DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_usuario (usuario_id),
                INDEX idx_lida (lida),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[NOTIFICAÇÕES] ✅ Tabela notificacoes verificada/criada');
    } catch (error) {
        console.error('[NOTIFICAÇÕES] Erro ao criar tabela:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    // Atrasar a criação da tabela para garantir que pool está disponível
    setTimeout(() => ensureTable(), 2000);
    return router;
};
