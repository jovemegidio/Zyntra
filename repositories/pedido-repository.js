/**
 * Pedido Repository — encapsulates all pedidos-related SQL queries.
 * @module repositories/pedido-repository
 */
const BaseRepository = require('./base-repository');

const PEDIDO_SELECT_FIELDS = `
    p.id, p.valor, p.valor as valor_total, p.status, p.created_at, p.created_at as data_pedido,
    p.vendedor_id, p.cliente_id, p.observacao,
    p.nf, p.numero_nf, p.nfe_chave,
    COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') AS cliente_nome,
    c.email AS cliente_email, c.telefone AS cliente_telefone,
    e.nome_fantasia AS empresa_nome,
    u.nome AS vendedor_nome`;

const PEDIDO_JOINS = `
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    LEFT JOIN empresas e ON p.empresa_id = e.id
    LEFT JOIN usuarios u ON p.vendedor_id = u.id`;

const PEDIDO_DETAIL_SELECT = `
    p.*, p.valor as valor_total, p.created_at as data_pedido,
    p.transportadora_id, p.transportadora_nome,
    COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') AS cliente_nome,
    c.email AS cliente_email, c.telefone AS cliente_telefone,
    e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
    u.nome AS vendedor_nome,
    t.razao_social AS transp_razao_social,
    t.cnpj_cpf AS transp_cnpj,
    t.telefone AS transp_telefone,
    t.email AS transp_email,
    t.cidade AS transp_cidade,
    t.estado AS transp_estado,
    t.bairro AS transp_bairro,
    t.cep AS transp_cep,
    t.endereco AS transp_endereco`;

const PEDIDO_DETAIL_JOINS = `
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    LEFT JOIN empresas e ON p.empresa_id = e.id
    LEFT JOIN usuarios u ON p.vendedor_id = u.id
    LEFT JOIN transportadoras t ON p.transportadora_id = t.id`;

class PedidoRepository extends BaseRepository {
    /**
     * List pedidos with optional period filter and pagination.
     */
    async list({ period, page = 1, limit = 1000 } = {}) {
        let whereClause = '';
        const params = [];
        if (period && period !== 'all') {
            whereClause = 'WHERE p.created_at >= CURDATE() - INTERVAL ? DAY';
            params.push(parseInt(period));
        }
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

        return this.query(
            `SELECT ${PEDIDO_SELECT_FIELDS} ${PEDIDO_JOINS} ${whereClause} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
            params
        );
    }

    /**
     * Search pedidos by client name, empresa name, pedido id, or vendedor name.
     */
    async search(q) {
        const like = `%${q}%`;
        return this.query(
            `SELECT ${PEDIDO_SELECT_FIELDS} ${PEDIDO_JOINS}
             WHERE c.nome_fantasia LIKE ? OR c.razao_social LIKE ? OR c.nome LIKE ?
                OR e.nome_fantasia LIKE ? OR p.id LIKE ? OR u.nome LIKE ?
             ORDER BY p.id DESC`,
            [like, like, like, like, like, like]
        );
    }

    /**
     * Get a single pedido with full detail (including transportadora).
     */
    async findById(id) {
        return this.queryOne(
            `SELECT ${PEDIDO_DETAIL_SELECT} ${PEDIDO_DETAIL_JOINS} WHERE p.id = ?`,
            [id]
        );
    }

    /**
     * Update pedido status.
     */
    async updateStatus(id, status) {
        return this.execute('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    }

    /**
     * Update pedido valor.
     */
    async updateValor(id, valor) {
        return this.execute('UPDATE pedidos SET valor = ? WHERE id = ?', [valor, id]);
    }

    /**
     * Delete a pedido and its itens (in transaction).
     */
    async delete(id) {
        return this.transaction(async (conn) => {
            await conn.query('DELETE FROM pedido_itens WHERE pedido_id = ?', [id]);
            await conn.query('DELETE FROM pedidos WHERE id = ?', [id]);
        });
    }

    /**
     * Get pedido itens.
     */
    async getItens(pedidoId) {
        return this.query(
            `SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial,
                    unidade, local_estoque, preco_unitario, desconto, subtotal
             FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC`,
            [pedidoId]
        );
    }

    /**
     * Insert a pedido historico entry.
     */
    async addHistorico({ pedidoId, usuarioId, acao, detalhes }) {
        return this.execute(
            `INSERT INTO pedido_historico (pedido_id, usuario_id, acao, detalhes, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [pedidoId, usuarioId, acao, detalhes]
        );
    }

    /**
     * Get pedido historico.
     */
    async getHistorico(pedidoId) {
        return this.query(
            `SELECT ph.*, u.nome AS usuario_nome
             FROM pedido_historico ph
             LEFT JOIN usuarios u ON ph.usuario_id = u.id
             WHERE ph.pedido_id = ? ORDER BY ph.created_at DESC`,
            [pedidoId]
        );
    }
}

module.exports = PedidoRepository;
