/**
 * Cliente Repository — encapsulates clientes table queries.
 * @module repositories/cliente-repository
 */
const BaseRepository = require('./base-repository');

class ClienteRepository extends BaseRepository {
    async getClienteColumns() {
        if (!this._clienteColumns) {
            const rows = await this.query('SHOW COLUMNS FROM clientes');
            this._clienteColumns = new Set(rows.map(col => col.Field));
        }
        return this._clienteColumns;
    }

    buildOwnerFilter(columns, { vendedorId = null, vendedorNome = null } = {}, alias = 'c') {
        const conditions = [];
        const params = [];
        const prefix = alias ? `${alias}.` : '';

        if (vendedorId) {
            ['vendedor_id', 'usuario_id', 'user_id', 'created_by'].forEach(field => {
                if (columns.has(field)) {
                    conditions.push(`${prefix}${field} = ?`);
                    params.push(vendedorId);
                }
            });
        }

        if (vendedorNome) {
            ['vendedor_proprietario', 'vendedor_responsavel', 'incluido_por'].forEach(field => {
                if (columns.has(field)) {
                    conditions.push(`${prefix}${field} = ?`);
                    params.push(vendedorNome);
                }
            });
        }

        return conditions.length ? { sql: `(${conditions.join(' OR ')})`, params } : { sql: '', params: [] };
    }

    /**
     * List clientes with optional admin/vendedor filtering and pagination.
     */
    async list({ page = 1, limit = 2000, isAdmin = false, isComercial = false, vendedorId = null, vendedorNome = null } = {}) {
        const offset = (parseInt(page) - 1) * parseInt(limit);
        let where = '';
        const params = [];

        if (isComercial && (vendedorId || vendedorNome)) {
            const columns = await this.getClienteColumns();
            const ownerFilter = this.buildOwnerFilter(columns, { vendedorId, vendedorNome });
            if (ownerFilter.sql) {
                where = `WHERE ${ownerFilter.sql}`;
                params.push(...ownerFilter.params);
            }
        }

        params.push(parseInt(limit), offset);

        return this.query(
            `SELECT c.id, c.nome, c.razao_social, c.nome_fantasia, c.email, c.telefone,
                    c.cnpj, c.cpf, c.cnpj_cpf, c.cidade, c.estado, c.ativo,
                    c.vendedor_responsavel, c.vendedor_proprietario,
                    c.created_at, c.data_cadastro,
                    e.nome_fantasia AS empresa_nome
             FROM clientes c
             LEFT JOIN empresas e ON c.empresa_id = e.id
             ${where} ORDER BY c.nome ASC LIMIT ? OFFSET ?`,
            params
        );
    }

    async findById(id) {
        return this.queryOne('SELECT * FROM clientes WHERE id = ?', [id]);
    }

    async search(q, { isAdmin = false, isComercial = false, vendedorId = null, vendedorNome = null } = {}) {
        const like = `%${q}%`;
        let where = 'WHERE (c.nome LIKE ? OR c.nome_fantasia LIKE ? OR c.razao_social LIKE ? OR c.cnpj LIKE ? OR c.email LIKE ?)';
        const params = [like, like, like, like, like];

        if (isComercial && (vendedorId || vendedorNome)) {
            const columns = await this.getClienteColumns();
            const ownerFilter = this.buildOwnerFilter(columns, { vendedorId, vendedorNome });
            if (ownerFilter.sql) {
                where += ` AND ${ownerFilter.sql}`;
                params.push(...ownerFilter.params);
            }
        }

        return this.query(
            `SELECT c.id, c.nome, c.nome_fantasia, c.cnpj, c.email, c.telefone
             FROM clientes c
             LEFT JOIN empresas e ON c.empresa_id = e.id
             ${where} ORDER BY c.nome ASC LIMIT 20`,
            params
        );
    }
}

module.exports = ClienteRepository;
