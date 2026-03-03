/**
 * RH Treinamentos Routes — migrado de modules/RH/server.js para ser montado no servidor principal.
 * Fornece CRUD de treinamentos, inscrições, dashboard e categorias.
 * @module routes/rh-treinamentos
 */
const express = require('express');

module.exports = function createRHTreinamentosRoutes(deps) {
    const { pool, authenticateToken } = deps;
    const router = express.Router();

    // Helper: verificar se é admin
    function isAdminUser(user) {
        if (!user) return false;
        return user.is_admin === 1 || user.is_admin === true ||
               user.role === 'admin' || user.role === 'superadmin' ||
               user.role === 'rh_admin';
    }

    // Middleware de autenticação global para todas as rotas
    router.use(authenticateToken);

    // ===================== CRUD TREINAMENTOS =====================

    /**
     * GET /api/rh/treinamentos
     * Listar treinamentos com filtros opcionais
     */
    router.get('/treinamentos', async (req, res) => {
        try {
            const { status, tipo, categoria, periodo } = req.query;
            let sql = `
                SELECT t.*,
                    (SELECT COUNT(*) FROM rh_inscricoes_treinamento WHERE treinamento_id = t.id AND status != 'cancelado') as inscritos,
                    f.nome_completo as criador_nome
                FROM rh_treinamentos t
                LEFT JOIN funcionarios f ON t.criado_por = f.id
                WHERE 1=1
            `;
            const params = [];

            if (status && status !== 'todos') {
                sql += ' AND t.status = ?';
                params.push(status);
            }
            if (tipo) {
                sql += ' AND t.tipo = ?';
                params.push(tipo);
            }
            if (categoria) {
                sql += ' AND t.categoria = ?';
                params.push(categoria);
            }
            if (periodo) {
                const hoje = new Date().toISOString().split('T')[0];
                if (periodo === 'proximos') {
                    sql += ' AND t.data_inicio >= ?';
                    params.push(hoje);
                } else if (periodo === 'passados') {
                    sql += ' AND t.data_fim < ?';
                    params.push(hoje);
                }
            }

            sql += ' ORDER BY t.data_inicio DESC';

            const [treinamentos] = await pool.query(sql, params);
            res.json(treinamentos);
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao listar treinamentos:', error);
            res.status(500).json({ error: 'Erro ao listar treinamentos' });
        }
    });

    /**
     * GET /api/rh/treinamentos-dashboard
     * Dashboard com estatísticas de treinamentos
     */
    router.get('/treinamentos-dashboard', async (req, res) => {
        try {
            const [[stats]] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'agendado' THEN 1 ELSE 0 END) as agendados,
                    SUM(CASE WHEN status = 'em_andamento' THEN 1 ELSE 0 END) as em_andamento,
                    SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) as concluidos,
                    SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) as cancelados
                FROM rh_treinamentos
            `);

            const [[inscricoes]] = await pool.query(`
                SELECT
                    COUNT(*) as total_inscricoes,
                    SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) as concluidos,
                    AVG(nota_avaliacao) as media_notas
                FROM rh_inscricoes_treinamento
            `);

            const [proximos] = await pool.query(`
                SELECT t.*,
                    (SELECT COUNT(*) FROM rh_inscricoes_treinamento WHERE treinamento_id = t.id AND status != 'cancelado') as inscritos
                FROM rh_treinamentos t
                WHERE t.data_inicio >= CURDATE() AND t.status = 'agendado'
                ORDER BY t.data_inicio ASC
                LIMIT 5
            `);

            const [porCategoria] = await pool.query(`
                SELECT categoria, COUNT(*) as total
                FROM rh_treinamentos
                WHERE categoria IS NOT NULL
                GROUP BY categoria
                ORDER BY total DESC
            `);

            res.json({
                stats: stats || {},
                inscricoes: inscricoes || {},
                proximos,
                porCategoria
            });
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao buscar dashboard:', error);
            res.status(500).json({ error: 'Erro ao buscar dashboard de treinamentos' });
        }
    });

    /**
     * GET /api/rh/treinamentos-categorias
     * Listar categorias distintas
     */
    router.get('/treinamentos-categorias', async (req, res) => {
        try {
            const [categorias] = await pool.query(`
                SELECT DISTINCT categoria FROM rh_treinamentos
                WHERE categoria IS NOT NULL AND categoria != ''
                ORDER BY categoria
            `);
            res.json(categorias.map(c => c.categoria));
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao buscar categorias:', error);
            res.status(500).json({ error: 'Erro ao buscar categorias' });
        }
    });

    /**
     * GET /api/rh/treinamentos/:id
     * Obter treinamento por ID com lista de inscritos
     */
    router.get('/treinamentos/:id', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT t.*, f.nome_completo as criador_nome
                FROM rh_treinamentos t
                LEFT JOIN funcionarios f ON t.criado_por = f.id
                WHERE t.id = ?
            `, [req.params.id]);

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Treinamento não encontrado' });
            }

            const treinamento = rows[0];

            // Buscar inscritos
            const [inscritos] = await pool.query(`
                SELECT i.*, f.nome_completo, f.cargo, f.departamento
                FROM rh_inscricoes_treinamento i
                JOIN funcionarios f ON i.funcionario_id = f.id
                WHERE i.treinamento_id = ?
                ORDER BY i.data_inscricao ASC
            `, [req.params.id]);

            res.json({ ...treinamento, inscritos });
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao buscar treinamento:', error);
            res.status(500).json({ error: 'Erro ao buscar treinamento' });
        }
    });

    /**
     * POST /api/rh/treinamentos
     * Criar novo treinamento
     */
    router.post('/treinamentos', async (req, res) => {
        try {
            const {
                titulo, descricao, tipo, categoria, carga_horaria, instrutor,
                local_treinamento, data_inicio, data_fim, horario_inicio, horario_fim,
                vagas_totais, obrigatorio, departamentos_alvo
            } = req.body;

            if (!titulo || !data_inicio) {
                return res.status(400).json({ error: 'Título e data de início são obrigatórios' });
            }

            const [result] = await pool.query(`
                INSERT INTO rh_treinamentos (
                    titulo, descricao, tipo, categoria, carga_horaria, instrutor,
                    local_treinamento, data_inicio, data_fim, horario_inicio, horario_fim,
                    vagas_totais, vagas_disponiveis, obrigatorio, departamentos_alvo, criado_por
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                titulo, descricao, tipo || 'presencial', categoria, carga_horaria || 0, instrutor,
                local_treinamento, data_inicio, data_fim || data_inicio, horario_inicio, horario_fim,
                vagas_totais || 0, vagas_totais || 0, obrigatorio || false,
                JSON.stringify(departamentos_alvo || []), req.user?.id
            ]);

            res.status(201).json({ success: true, id: result.insertId, message: 'Treinamento criado com sucesso' });
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao criar treinamento:', error);
            res.status(500).json({ error: 'Erro ao criar treinamento' });
        }
    });

    /**
     * PUT /api/rh/treinamentos/:id
     * Atualizar treinamento (admin only)
     */
    router.put('/treinamentos/:id', async (req, res) => {
        try {
            if (!isAdminUser(req.user)) {
                return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem atualizar treinamentos.' });
            }

            const {
                titulo, descricao, tipo, categoria, carga_horaria, instrutor,
                local_treinamento, data_inicio, data_fim, horario_inicio, horario_fim,
                vagas_totais, status, obrigatorio, departamentos_alvo
            } = req.body;

            // Calcular vagas disponíveis
            const [[inscricoesCount]] = await pool.query(`
                SELECT COUNT(*) as total FROM rh_inscricoes_treinamento
                WHERE treinamento_id = ? AND status != 'cancelado'
            `, [req.params.id]);

            const vagasDisponiveis = (vagas_totais || 0) - (inscricoesCount?.total || 0);

            await pool.query(`
                UPDATE rh_treinamentos SET
                    titulo = ?, descricao = ?, tipo = ?, categoria = ?, carga_horaria = ?,
                    instrutor = ?, local_treinamento = ?, data_inicio = ?, data_fim = ?,
                    horario_inicio = ?, horario_fim = ?, vagas_totais = ?, vagas_disponiveis = ?,
                    status = ?, obrigatorio = ?, departamentos_alvo = ?
                WHERE id = ?
            `, [
                titulo, descricao, tipo, categoria, carga_horaria,
                instrutor, local_treinamento, data_inicio, data_fim,
                horario_inicio, horario_fim, vagas_totais, Math.max(0, vagasDisponiveis),
                status, obrigatorio, JSON.stringify(departamentos_alvo || []), req.params.id
            ]);

            res.json({ success: true, message: 'Treinamento atualizado' });
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao atualizar treinamento:', error);
            res.status(500).json({ error: 'Erro ao atualizar treinamento' });
        }
    });

    /**
     * DELETE /api/rh/treinamentos/:id
     * Excluir treinamento (admin only)
     */
    router.delete('/treinamentos/:id', async (req, res) => {
        try {
            if (!isAdminUser(req.user)) {
                return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem excluir treinamentos.' });
            }

            await pool.query('DELETE FROM rh_treinamentos WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Treinamento excluído' });
        } catch (error) {
            console.error('[RH-TREINAMENTOS] Erro ao excluir treinamento:', error);
            res.status(500).json({ error: 'Erro ao excluir treinamento' });
        }
    });

    return router;
};
