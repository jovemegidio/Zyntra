/**
 * /api/avisos — Central de avisos do hub multi-empresa
 *
 * Endpoints:
 *   GET    /api/avisos          (qualquer usuário autenticado pode ler)
 *   POST   /api/avisos          (apenas emails em AVISOS_ADMIN_EMAILS)
 *   PUT    /api/avisos/:id      (apenas emails em AVISOS_ADMIN_EMAILS)
 *   DELETE /api/avisos/:id      (apenas emails em AVISOS_ADMIN_EMAILS)
 *
 * O dashboard.js do hub faz fetch em GET /api/avisos no carregamento.
 */

module.exports = function createAvisosRouter(pool, authenticateToken) {
    const router = require('express').Router();

    const TIPOS_VALIDOS = ['update', 'maintenance', 'feature', 'alert'];

    // Allowlist EXPLÍCITA por email. CRUD de avisos é privilégio especial,
    // separado do flag genérico is_admin. Para adicionar novos gerentes,
    // basta colocar o email aqui (lower-case).
    const AVISOS_ADMIN_EMAILS = ['ti@aluforce.ind.br'];

    function isAvisosAdmin(req) {
        const email = String(req.user?.email || '').toLowerCase().trim();
        return !!email && AVISOS_ADMIN_EMAILS.includes(email);
    }

    function sanitizePayload(body) {
        const tipo = TIPOS_VALIDOS.includes(body.tipo) ? body.tipo : 'update';
        return {
            tipo,
            tag_text:    body.tag_text    ? String(body.tag_text).slice(0, 50)  : null,
            titulo:      String(body.titulo || '').slice(0, 200),
            descricao:   String(body.descricao || '').slice(0, 2000),
            action_text: body.action_text ? String(body.action_text).slice(0, 60) : null,
            action_url:  body.action_url  ? String(body.action_url).slice(0, 500) : null,
            ordem:       Number.isFinite(Number(body.ordem)) ? Number(body.ordem) : 0,
            ativo:       (body.ativo === false || body.ativo === 0 || body.ativo === '0') ? 0 : 1,
            data_inicio: body.data_inicio || null,
            data_fim:    body.data_fim    || null,
        };
    }

    // ============ GET ============
    // Lista avisos ATIVOS dentro da janela de tempo, no formato consumido pelo dashboard.js
    router.get('/avisos', authenticateToken, async (req, res) => {
        try {
            const includeInactive = req.query.all === '1' && isAvisosAdmin(req);
            const where = includeInactive
                ? '1=1'
                : `ativo=1
                   AND (data_inicio IS NULL OR data_inicio <= NOW())
                   AND (data_fim    IS NULL OR data_fim    >= NOW())`;
            const [rows] = await pool.query(
                `SELECT id, tipo, tag_text, titulo, descricao, action_text, action_url,
                        ordem, ativo, data_inicio, data_fim, created_at, updated_at
                   FROM hub_avisos
                  WHERE ${where}
                  ORDER BY ordem ASC, id DESC`
            );
            const avisos = rows.map(r => ({
                id: r.id,
                type: r.tipo,
                tagText: r.tag_text || undefined,
                title: r.titulo,
                desc: r.descricao,
                actionText: r.action_text || undefined,
                actionUrl:  r.action_url  || undefined,
                ordem: r.ordem,
                ativo: !!r.ativo,
                dataInicio: r.data_inicio,
                dataFim: r.data_fim,
            }));
            res.json({ avisos });
        } catch (err) {
            console.error('[avisos] GET erro:', err.message);
            res.status(500).json({ message: 'Erro ao listar avisos', error: err.message });
        }
    });

    // ============ POST ============
    router.post('/avisos', authenticateToken, async (req, res) => {
        if (!isAvisosAdmin(req)) return res.status(403).json({ message: 'Apenas administradores' });
        try {
            const p = sanitizePayload(req.body || {});
            if (!p.titulo || !p.descricao) {
                return res.status(400).json({ message: 'titulo e descricao são obrigatórios' });
            }
            const [result] = await pool.query(
                `INSERT INTO hub_avisos (tipo, tag_text, titulo, descricao, action_text, action_url, ordem, ativo, data_inicio, data_fim)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [p.tipo, p.tag_text, p.titulo, p.descricao, p.action_text, p.action_url, p.ordem, p.ativo, p.data_inicio, p.data_fim]
            );
            res.status(201).json({ id: result.insertId });
        } catch (err) {
            console.error('[avisos] POST erro:', err.message);
            res.status(500).json({ message: 'Erro ao criar aviso', error: err.message });
        }
    });

    // ============ PUT ============
    router.put('/avisos/:id', authenticateToken, async (req, res) => {
        if (!isAvisosAdmin(req)) return res.status(403).json({ message: 'Apenas administradores' });
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ message: 'id inválido' });
        try {
            const p = sanitizePayload(req.body || {});
            const [result] = await pool.query(
                `UPDATE hub_avisos
                    SET tipo=?, tag_text=?, titulo=?, descricao=?, action_text=?, action_url=?,
                        ordem=?, ativo=?, data_inicio=?, data_fim=?
                  WHERE id=?`,
                [p.tipo, p.tag_text, p.titulo, p.descricao, p.action_text, p.action_url,
                 p.ordem, p.ativo, p.data_inicio, p.data_fim, id]
            );
            if (!result.affectedRows) return res.status(404).json({ message: 'Aviso não encontrado' });
            res.json({ id, updated: true });
        } catch (err) {
            console.error('[avisos] PUT erro:', err.message);
            res.status(500).json({ message: 'Erro ao atualizar aviso', error: err.message });
        }
    });

    // ============ DELETE ============
    router.delete('/avisos/:id', authenticateToken, async (req, res) => {
        if (!isAvisosAdmin(req)) return res.status(403).json({ message: 'Apenas administradores' });
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ message: 'id inválido' });
        try {
            const [result] = await pool.query('DELETE FROM hub_avisos WHERE id=?', [id]);
            if (!result.affectedRows) return res.status(404).json({ message: 'Aviso não encontrado' });
            res.json({ id, deleted: true });
        } catch (err) {
            console.error('[avisos] DELETE erro:', err.message);
            res.status(500).json({ message: 'Erro ao excluir aviso', error: err.message });
        }
    });

    return router;
};
