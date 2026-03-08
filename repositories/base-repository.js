/**
 * Base Repository — shared query helpers for all repositories.
 * @module repositories/base-repository
 */
class BaseRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async query(sql, params = []) {
        const [rows] = await this.pool.query(sql, params);
        return rows;
    }

    async queryOne(sql, params = []) {
        const rows = await this.query(sql, params);
        return rows[0] || null;
    }

    async execute(sql, params = []) {
        const [result] = await this.pool.query(sql, params);
        return result;
    }

    async transaction(fn) {
        const conn = await this.pool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await fn(conn);
            await conn.commit();
            return result;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }
}

module.exports = BaseRepository;
