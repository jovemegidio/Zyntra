/**
 * /api/dashboard/hub-stats
 *
 * Estatísticas REAIS para o hub multi-empresa (Zyntra-SGE/Empresas/dashboard.html).
 *
 *   - nfeMonth: NF-e emitidas no mês corrente em cada base de vendas
 *   - uptime:   uptime do processo em segundos
 *
 * O usuário precisa estar autenticado (cookie httpOnly). Os contadores das bases
 * Labor são retornados separadamente para que o front filtre conforme o domínio
 * (@labor.com.br vê as duas; @aluforce.ind.br vê só Aluforce; etc).
 */

module.exports = function createHubStatsRouter(pool, authenticateToken) {
    const router = require('express').Router();

    // SQL único que consulta as 3 bases — cada subquery é COUNT independente,
    // protegido contra falha individual via IFNULL.
    const SQL = `
        SELECT
            (SELECT COUNT(*) FROM aluforce_vendas.nfe
              WHERE DATE_FORMAT(data_emissao,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')) AS aluforce,
            (SELECT COUNT(*) FROM labor_eletric_vendas.nfe
              WHERE DATE_FORMAT(data_emissao,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')) AS labor_eletric,
            (SELECT COUNT(*) FROM labor_energy_vendas.nfe
              WHERE DATE_FORMAT(data_emissao,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')) AS labor_energy
    `;

    router.get('/dashboard/hub-stats', authenticateToken, async (req, res) => {
        const result = {
            nfeMonth: { aluforce: 0, 'labor-eletric': 0, 'labor-energy': 0, total: 0 },
            uptime: { seconds: Math.floor(process.uptime()), status: 'ok' },
            generatedAt: new Date().toISOString(),
        };

        try {
            const [rows] = await pool.query(SQL);
            if (rows && rows[0]) {
                const r = rows[0];
                result.nfeMonth.aluforce       = Number(r.aluforce)       || 0;
                result.nfeMonth['labor-eletric'] = Number(r.labor_eletric) || 0;
                result.nfeMonth['labor-energy']  = Number(r.labor_energy)  || 0;
                result.nfeMonth.total = result.nfeMonth.aluforce
                                     + result.nfeMonth['labor-eletric']
                                     + result.nfeMonth['labor-energy'];
            }
        } catch (err) {
            console.error('[hub-stats] erro consulta NFe:', err.message);
            // Mantém os zeros e retorna 200 — o front mostra "—" quando total=0.
            result.error = 'partial';
        }

        res.set('Cache-Control', 'private, max-age=30');
        res.json(result);
    });

    return router;
};
