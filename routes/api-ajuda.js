/**
 * /api/ajuda — Engajamento da Central de Ajuda
 *
 * Endpoints (todos exigem auth):
 *   GET    /api/ajuda/artigo-stats?slug=...   → { curtidas, jaCurtiu, comentarios }
 *   POST   /api/ajuda/curtida                 → toggle (curte se não estiver curtido, descurte caso contrário)
 *   GET    /api/ajuda/comentarios?slug=...    → { comentarios: [...] } ordenado por data desc
 *   POST   /api/ajuda/comentarios             → cria comentário { artigo_slug, conteudo, parent_id? }
 *   DELETE /api/ajuda/comentarios/:id         → soft-delete (só o autor ou admin)
 */
module.exports = function createAjudaRouter(pool, authenticateToken) {
    const router = require('express').Router();

    function isAdmin(req) {
        const role = String(req.user?.role || '').toLowerCase().trim();
        return role === 'admin' || role === 'administrador'
            || req.user?.is_admin === 1 || req.user?.is_admin === true || req.user?.is_admin === '1';
    }

    // slug é o "caminho/identificador" do artigo (ex: "artigos/emitir-nfe").
    // Aceitamos letras/numeros/underline/hifen/slash/ponto, máx 200 chars.
    function validSlug(s) {
        return typeof s === 'string' && s.length > 0 && s.length <= 200 && /^[\w\-/.]+$/.test(s);
    }

    // ===== GET /artigo-stats =====
    router.get('/ajuda/artigo-stats', authenticateToken, async (req, res) => {
        const slug = String(req.query.slug || '');
        if (!validSlug(slug)) return res.status(400).json({ message: 'slug inválido' });
        try {
            const userId = req.user?.id || req.user?.userId || null;
            const [curRows] = await pool.query(
                `SELECT COUNT(*) AS total,
                        SUM(CASE WHEN usuario_id=? THEN 1 ELSE 0 END) AS minha
                   FROM ajuda_curtidas WHERE artigo_slug=?`,
                [userId, slug]
            );
            const [comRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM ajuda_comentarios
                  WHERE artigo_slug=? AND deletado=0`,
                [slug]
            );
            res.json({
                curtidas: Number(curRows[0]?.total) || 0,
                jaCurtiu: Number(curRows[0]?.minha) > 0,
                comentarios: Number(comRows[0]?.total) || 0,
            });
        } catch (err) {
            console.error('[ajuda] stats erro:', err.message);
            res.status(500).json({ message: 'Erro ao buscar stats', error: err.message });
        }
    });

    // ===== POST /curtida (toggle) =====
    router.post('/ajuda/curtida', authenticateToken, async (req, res) => {
        const slug = String(req.body?.artigo_slug || '');
        if (!validSlug(slug)) return res.status(400).json({ message: 'slug inválido' });
        const userId = req.user?.id || req.user?.userId;
        const email = String(req.user?.email || '');
        if (!userId || !email) return res.status(401).json({ message: 'Sessão inválida' });

        try {
            const [exist] = await pool.query(
                `SELECT id FROM ajuda_curtidas WHERE artigo_slug=? AND usuario_id=? LIMIT 1`,
                [slug, userId]
            );
            let jaCurtiu;
            if (exist.length) {
                await pool.query(`DELETE FROM ajuda_curtidas WHERE id=?`, [exist[0].id]);
                jaCurtiu = false;
            } else {
                await pool.query(
                    `INSERT INTO ajuda_curtidas (artigo_slug, usuario_id, usuario_email) VALUES (?,?,?)`,
                    [slug, userId, email]
                );
                jaCurtiu = true;
            }
            const [[{ total }]] = await pool.query(
                `SELECT COUNT(*) AS total FROM ajuda_curtidas WHERE artigo_slug=?`, [slug]
            );
            res.json({ jaCurtiu, curtidas: Number(total) || 0 });
        } catch (err) {
            console.error('[ajuda] curtida erro:', err.message);
            res.status(500).json({ message: 'Erro ao curtir', error: err.message });
        }
    });

    // ===== GET /comentarios =====
    router.get('/ajuda/comentarios', authenticateToken, async (req, res) => {
        const slug = String(req.query.slug || '');
        if (!validSlug(slug)) return res.status(400).json({ message: 'slug inválido' });
        try {
            const [rows] = await pool.query(
                `SELECT id, parent_id, usuario_id, usuario_email, usuario_nome, usuario_foto,
                        conteudo, created_at
                   FROM ajuda_comentarios
                  WHERE artigo_slug=? AND deletado=0
                  ORDER BY COALESCE(parent_id, id) ASC, created_at ASC`,
                [slug]
            );
            res.json({ comentarios: rows });
        } catch (err) {
            console.error('[ajuda] comentarios GET erro:', err.message);
            res.status(500).json({ message: 'Erro ao listar comentários', error: err.message });
        }
    });

    // ===== POST /comentarios =====
    router.post('/ajuda/comentarios', authenticateToken, async (req, res) => {
        const slug = String(req.body?.artigo_slug || '');
        const conteudo = String(req.body?.conteudo || '').trim().slice(0, 4000);
        const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
        if (!validSlug(slug)) return res.status(400).json({ message: 'slug inválido' });
        if (!conteudo) return res.status(400).json({ message: 'conteudo obrigatório' });
        const userId = req.user?.id || req.user?.userId;
        const email = String(req.user?.email || '');
        if (!userId || !email) return res.status(401).json({ message: 'Sessão inválida' });

        try {
            const [result] = await pool.query(
                `INSERT INTO ajuda_comentarios
                    (artigo_slug, parent_id, usuario_id, usuario_email, usuario_nome, usuario_foto, conteudo)
                 VALUES (?,?,?,?,?,?,?)`,
                [
                    slug,
                    Number.isFinite(parentId) ? parentId : null,
                    userId, email,
                    req.user?.nome || req.user?.name || null,
                    req.user?.foto || req.user?.avatar || null,
                    conteudo,
                ]
            );
            const [rows] = await pool.query(
                `SELECT id, parent_id, usuario_id, usuario_email, usuario_nome, usuario_foto,
                        conteudo, created_at
                   FROM ajuda_comentarios WHERE id=?`,
                [result.insertId]
            );
            res.status(201).json({ comentario: rows[0] });
        } catch (err) {
            console.error('[ajuda] comentarios POST erro:', err.message);
            res.status(500).json({ message: 'Erro ao comentar', error: err.message });
        }
    });

    // ===== DELETE /comentarios/:id (autor ou admin) =====
    router.delete('/ajuda/comentarios/:id', authenticateToken, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ message: 'id inválido' });
        const userId = req.user?.id || req.user?.userId;
        try {
            const [own] = await pool.query(
                `SELECT usuario_id FROM ajuda_comentarios WHERE id=? AND deletado=0`, [id]
            );
            if (!own.length) return res.status(404).json({ message: 'Comentário não encontrado' });
            if (own[0].usuario_id !== userId && !isAdmin(req)) {
                return res.status(403).json({ message: 'Apenas o autor ou admin pode excluir' });
            }
            await pool.query(`UPDATE ajuda_comentarios SET deletado=1 WHERE id=?`, [id]);
            res.json({ id, deleted: true });
        } catch (err) {
            console.error('[ajuda] comentarios DELETE erro:', err.message);
            res.status(500).json({ message: 'Erro ao excluir', error: err.message });
        }
    });

    return router;
};
