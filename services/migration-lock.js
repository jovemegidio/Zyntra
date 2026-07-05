// ============================================
// MIGRATION LOCK — Serializa migrations via GET_LOCK MySQL
// ============================================
// O server roda em cluster (vários workers concorrentes) e cada worker tenta
// rodar runMigrations() no boot. ALTER TABLE concorrentes geram
// "Deadlock found when trying to get lock; try restarting transaction" e podem
// deixar o schema em estado inconsistente (ex: coluna pedido_id ausente em maio/12).
//
// GET_LOCK do MySQL é um named lock por sessão. Apenas um worker consegue adquirir
// por vez; os demais recebem timeout e pulam migrations (idempotente — quem
// adquiriu já cria o schema necessário).

async function acquireMigrationLock(pool, name = 'zyntra_migrations', timeoutSec = 60) {
    let conn;
    try {
        conn = await pool.getConnection();
    } catch (_) {
        return null;
    }
    try {
        const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [name, timeoutSec]);
        const got = rows && rows[0] && rows[0].got;
        if (got === 1) return conn;
        conn.release();
        return null;
    } catch (_) {
        try { conn.release(); } catch (__) {}
        return null;
    }
}

async function releaseMigrationLock(conn, name = 'zyntra_migrations') {
    if (!conn) return;
    try {
        await conn.query('SELECT RELEASE_LOCK(?)', [name]);
    } catch (_) {}
    try {
        conn.release();
    } catch (_) {}
}

/**
 * Helper que envolve uma callback de migration com lock advisory.
 * Se outro worker já está rodando, pula silenciosamente (idempotente).
 */
async function withMigrationLock(pool, name, fn, timeoutSec = 60) {
    const conn = await acquireMigrationLock(pool, name, timeoutSec);
    if (!conn) {
        console.log(`[MIGRATION-LOCK] ⏭️  ${name}: outro worker está rodando — pulando`);
        return false;
    }
    try {
        await fn();
        return true;
    } finally {
        await releaseMigrationLock(conn, name);
    }
}

module.exports = { acquireMigrationLock, releaseMigrationLock, withMigrationLock };
