/**
 * API DE WORKFLOW DE APROVAÇÕES - ALUFORCE V.2
 * Gerenciamento de fluxos de aprovação
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/workflow-aprovacoes/pendentes
 * Lista aprovações pendentes para o usuário
 */
router.get('/pendentes', async (req, res) => {
    try {
        const usuario_id = req.query.usuario_id || req.user?.id;

        const [pendentes] = await pool.query(`
            SELECT 
                wa.*,
                u.nome as solicitante_nome,
                u.email as solicitante_email
            FROM workflow_aprovacoes wa
            LEFT JOIN usuarios u ON wa.solicitante_id = u.id
            WHERE wa.aprovador_id = ? AND wa.status = 'pendente'
            ORDER BY wa.created_at DESC
        `, [usuario_id]);

        res.json({ success: true, data: pendentes });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/workflow-aprovacoes/minhas-solicitacoes
 * Lista solicitações feitas pelo usuário
 */
router.get('/minhas-solicitacoes', async (req, res) => {
    try {
        const usuario_id = req.query.usuario_id || req.user?.id;

        const [solicitacoes] = await pool.query(`
            SELECT 
                wa.*,
                u.nome as aprovador_nome,
                u.email as aprovador_email
            FROM workflow_aprovacoes wa
            LEFT JOIN usuarios u ON wa.aprovador_id = u.id
            WHERE wa.solicitante_id = ?
            ORDER BY wa.created_at DESC
        `, [usuario_id]);

        res.json({ success: true, data: solicitacoes });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * POST /api/workflow-aprovacoes/solicitar
 * Cria nova solicitação de aprovação
 */
router.post('/solicitar', async (req, res) => {
    try {
        const {
            tipo,
            referencia_id,
            referencia_tipo,
            titulo,
            descricao,
            valor,
            aprovador_id,
            solicitante_id,
            dados_extras
        } = req.body;

        if (!tipo || !titulo) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tipo e título são obrigatórios' 
            });
        }

        // Determinar aprovador automaticamente se não informado
        let aprovadorFinal = aprovador_id;
        if (!aprovadorFinal) {
            // Buscar regra de aprovação
            const [regras] = await pool.query(`
                SELECT aprovador_id FROM workflow_regras 
                WHERE tipo = ? AND ativo = 1
                AND (valor_minimo IS NULL OR ? >= valor_minimo)
                AND (valor_maximo IS NULL OR ? <= valor_maximo)
                ORDER BY prioridade DESC
                LIMIT 1
            `, [tipo, valor || 0, valor || 0]);

            if (regras.length) {
                aprovadorFinal = regras[0].aprovador_id;
            } else {
                // Buscar admin como fallback
                const [admins] = await pool.query(`
                    SELECT id FROM usuarios WHERE is_admin = 1 AND ativo = 1 LIMIT 1
                `);
                aprovadorFinal = admins.length ? admins[0].id : null;
            }
        }

        const [result] = await pool.query(`
            INSERT INTO workflow_aprovacoes (
                tipo, referencia_id, referencia_tipo, titulo, descricao,
                valor, aprovador_id, solicitante_id, status, dados_extras, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, NOW())
        `, [
            tipo,
            referencia_id,
            referencia_tipo,
            titulo,
            descricao,
            valor,
            aprovadorFinal,
            solicitante_id || req.user?.id,
            dados_extras ? JSON.stringify(dados_extras) : null
        ]);

        res.json({ 
            success: true, 
            message: 'Solicitação enviada com sucesso',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('[WORKFLOW] Erro ao criar solicitação:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar solicitação' });
    }
});

/**
 * PUT /api/workflow-aprovacoes/:id/aprovar
 * Aprova uma solicitação
 */
router.put('/:id/aprovar', async (req, res) => {
    try {
        const { id } = req.params;
        const { observacao, usuario_id } = req.body;

        await pool.query(`
            UPDATE workflow_aprovacoes SET
                status = 'aprovado',
                observacao_aprovador = ?,
                aprovado_por = ?,
                aprovado_em = NOW()
            WHERE id = ?
        `, [observacao, usuario_id || req.user?.id, id]);

        // Executar ação pós-aprovação
        await executarAcaoPosAprovacao(pool, id, 'aprovado');

        res.json({ success: true, message: 'Solicitação aprovada com sucesso' });
    } catch (error) {
        console.error('[WORKFLOW] Erro ao aprovar:', error);
        res.status(500).json({ success: false, error: 'Erro ao aprovar solicitação' });
    }
});

/**
 * PUT /api/workflow-aprovacoes/:id/rejeitar
 * Rejeita uma solicitação
 */
router.put('/:id/rejeitar', async (req, res) => {
    try {
        const { id } = req.params;
        const { observacao, usuario_id } = req.body;

        if (!observacao) {
            return res.status(400).json({ 
                success: false, 
                error: 'Motivo da rejeição é obrigatório' 
            });
        }

        await pool.query(`
            UPDATE workflow_aprovacoes SET
                status = 'rejeitado',
                observacao_aprovador = ?,
                aprovado_por = ?,
                aprovado_em = NOW()
            WHERE id = ?
        `, [observacao, usuario_id || req.user?.id, id]);

        // Executar ação pós-rejeição
        await executarAcaoPosAprovacao(pool, id, 'rejeitado');

        res.json({ success: true, message: 'Solicitação rejeitada' });
    } catch (error) {
        console.error('[WORKFLOW] Erro ao rejeitar:', error);
        res.status(500).json({ success: false, error: 'Erro ao rejeitar solicitação' });
    }
});

/**
 * GET /api/workflow-aprovacoes/regras
 * Lista regras de aprovação
 */
router.get('/regras', async (req, res) => {
    try {
        const [regras] = await pool.query(`
            SELECT 
                r.*,
                u.nome as aprovador_nome
            FROM workflow_regras r
            LEFT JOIN usuarios u ON r.aprovador_id = u.id
            WHERE r.ativo = 1
            ORDER BY r.tipo, r.prioridade DESC
        `);
        res.json({ success: true, data: regras });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * POST /api/workflow-aprovacoes/regras
 * Cria nova regra de aprovação
 */
router.post('/regras', async (req, res) => {
    try {
        const {
            tipo,
            descricao,
            aprovador_id,
            valor_minimo,
            valor_maximo,
            prioridade = 0
        } = req.body;

        if (!tipo || !aprovador_id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tipo e aprovador são obrigatórios' 
            });
        }

        const [result] = await pool.query(`
            INSERT INTO workflow_regras (
                tipo, descricao, aprovador_id, valor_minimo, valor_maximo, 
                prioridade, ativo, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, NOW())
        `, [tipo, descricao, aprovador_id, valor_minimo, valor_maximo, prioridade]);

        res.json({ 
            success: true, 
            message: 'Regra criada com sucesso',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('[WORKFLOW] Erro ao criar regra:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar regra' });
    }
});

/**
 * GET /api/workflow-aprovacoes/tipos
 * Lista tipos de aprovação disponíveis
 */
router.get('/tipos', async (req, res) => {
    res.json({
        success: true,
        data: [
            { codigo: 'pedido_desconto', nome: 'Desconto em Pedido', descricao: 'Aprovação de descontos em pedidos de venda' },
            { codigo: 'compra', nome: 'Ordem de Compra', descricao: 'Aprovação de ordens de compra' },
            { codigo: 'pagamento', nome: 'Pagamento', descricao: 'Aprovação de pagamentos' },
            { codigo: 'devolucao', nome: 'Devolução', descricao: 'Aprovação de devoluções' },
            { codigo: 'credito', nome: 'Liberação de Crédito', descricao: 'Aprovação de crédito para cliente' },
            { codigo: 'ferias', nome: 'Férias', descricao: 'Aprovação de solicitação de férias' },
            { codigo: 'hora_extra', nome: 'Hora Extra', descricao: 'Aprovação de horas extras' },
            { codigo: 'reembolso', nome: 'Reembolso', descricao: 'Aprovação de reembolsos' }
        ]
    });
});

/**
 * GET /api/workflow-aprovacoes/historico
 * Histórico de aprovações
 */
router.get('/historico', async (req, res) => {
    try {
        const { tipo, status, data_inicio, data_fim, limite = 100 } = req.query;

        let query = `
            SELECT 
                wa.*,
                sol.nome as solicitante_nome,
                apr.nome as aprovador_nome
            FROM workflow_aprovacoes wa
            LEFT JOIN usuarios sol ON wa.solicitante_id = sol.id
            LEFT JOIN usuarios apr ON wa.aprovado_por = apr.id
            WHERE 1=1
        `;
        const params = [];

        if (tipo) {
            query += ' AND wa.tipo = ?';
            params.push(tipo);
        }
        if (status) {
            query += ' AND wa.status = ?';
            params.push(status);
        }
        if (data_inicio) {
            query += ' AND wa.created_at >= ?';
            params.push(data_inicio);
        }
        if (data_fim) {
            query += ' AND wa.created_at <= ?';
            params.push(data_fim);
        }

        query += ' ORDER BY wa.created_at DESC LIMIT ?';
        params.push(parseInt(limite));

        const [historico] = await pool.query(query, params);
        res.json({ success: true, data: historico });
    } catch (error) {
        console.error('[WORKFLOW] Erro ao buscar histórico:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/workflow-aprovacoes/estatisticas
 * Estatísticas de aprovações
 */
router.get('/estatisticas', async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                SUM(CASE WHEN status = 'aprovado' THEN 1 ELSE 0 END) as aprovados,
                SUM(CASE WHEN status = 'rejeitado' THEN 1 ELSE 0 END) as rejeitados,
                AVG(TIMESTAMPDIFF(HOUR, created_at, aprovado_em)) as tempo_medio_horas
            FROM workflow_aprovacoes
        `);

        res.json({ success: true, data: stats[0] || {} });
    } catch (error) {
        res.json({ 
            success: true, 
            data: { total: 0, pendentes: 0, aprovados: 0, rejeitados: 0 }
        });
    }
});

// Função auxiliar para executar ações pós-aprovação
async function executarAcaoPosAprovacao(pool, aprovacaoId, status) {
    try {
        const [aprovacao] = await pool.query(`
            SELECT * FROM workflow_aprovacoes WHERE id = ?
        `, [aprovacaoId]);

        if (!aprovacao.length) return;

        const { tipo, referencia_id, referencia_tipo } = aprovacao[0];

        // Executar ações específicas por tipo
        if (status === 'aprovado') {
            switch (tipo) {
                case 'pedido_desconto':
                    // Atualizar status do pedido
                    if (referencia_tipo === 'pedido' && referencia_id) {
                        await pool.query(`
                            UPDATE pedidos SET desconto_aprovado = 1 WHERE id = ?
                        `, [referencia_id]).catch(() => {});
                    }
                    break;
                case 'compra':
                    if (referencia_tipo === 'ordem_compra' && referencia_id) {
                        await pool.query(`
                            UPDATE ordens_compra SET status = 'aprovada', aprovado_em = NOW() WHERE id = ?
                        `, [referencia_id]).catch(() => {});
                    }
                    break;
                // Adicionar outros tipos conforme necessário
            }
        }
    } catch (error) {
        console.error('[WORKFLOW] Erro na ação pós-aprovação:', error);
    }
}

// Criar tabelas necessárias
async function ensureTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS workflow_aprovacoes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tipo VARCHAR(100) NOT NULL,
                referencia_id INT,
                referencia_tipo VARCHAR(100),
                titulo VARCHAR(255) NOT NULL,
                descricao TEXT,
                valor DECIMAL(15,2),
                solicitante_id INT,
                aprovador_id INT,
                aprovado_por INT,
                status ENUM('pendente', 'aprovado', 'rejeitado') DEFAULT 'pendente',
                observacao_aprovador TEXT,
                dados_extras JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                aprovado_em DATETIME,
                INDEX idx_status (status),
                INDEX idx_aprovador (aprovador_id),
                INDEX idx_solicitante (solicitante_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS workflow_regras (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tipo VARCHAR(100) NOT NULL,
                descricao VARCHAR(255),
                aprovador_id INT,
                valor_minimo DECIMAL(15,2),
                valor_maximo DECIMAL(15,2),
                prioridade INT DEFAULT 0,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_tipo (tipo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        console.log('[WORKFLOW] ✅ Tabelas verificadas/criadas');
    } catch (error) {
        console.error('[WORKFLOW] Erro ao criar tabelas:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    ensureTables();
    return router;
};
