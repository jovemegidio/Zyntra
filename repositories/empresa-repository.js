/**
 * Empresa Repository — encapsulates empresas table queries.
 * @module repositories/empresa-repository
 */
const BaseRepository = require('./base-repository');

class EmpresaRepository extends BaseRepository {
    /**
     * List empresas with optional admin/vendedor filtering and pagination.
     */
    async list({ page = 1, limit = 20, isAdmin = false, vendedorId = null } = {}) {
        const offset = (parseInt(page) - 1) * parseInt(limit);
        let where = '';
        const params = [];

        if (!isAdmin && vendedorId) {
            where = 'WHERE vendedor_id = ? OR vendedor_id IS NULL';
            params.push(vendedorId);
        }

        params.push(parseInt(limit), offset);

        return this.query(
            `SELECT id, razao_social, nome_fantasia, cnpj, email, telefone, cidade, estado,
                    vendedor_id, data_criacao as created_at
             FROM empresas ${where} ORDER BY nome_fantasia ASC LIMIT ? OFFSET ?`,
            params
        );
    }

    async findById(id) {
        return this.queryOne('SELECT * FROM empresas WHERE id = ?', [id]);
    }

    async search(q, { isAdmin = false, vendedorId = null } = {}) {
        const like = `%${q}%`;
        let where = 'WHERE (nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?)';
        const params = [like, like, like];

        if (!isAdmin && vendedorId) {
            where += ' AND (vendedor_id = ? OR vendedor_id IS NULL)';
            params.push(vendedorId);
        }

        return this.query(
            `SELECT id, nome_fantasia, cnpj FROM empresas ${where} ORDER BY nome_fantasia LIMIT 10`,
            params
        );
    }
}

module.exports = EmpresaRepository;
