/**
 * Produto Repository — encapsulates produtos table queries.
 * @module repositories/produto-repository
 */
const BaseRepository = require('./base-repository');

class ProdutoRepository extends BaseRepository {
    /**
     * Search products by codigo (autocomplete).
     */
    async autocompleteByCodigo(q, limit = 20) {
        return this.query(
            `SELECT id, codigo, descricao, preco_venda, unidade, estoque_atual, ncm
             FROM produtos WHERE codigo LIKE ? ORDER BY codigo ASC LIMIT ?`,
            [`%${q}%`, limit]
        );
    }

    /**
     * Find product by exact codigo.
     */
    async findByCodigo(codigo) {
        return this.queryOne('SELECT * FROM produtos WHERE codigo = ?', [codigo]);
    }

    /**
     * Find product by id.
     */
    async findById(id) {
        return this.queryOne('SELECT * FROM produtos WHERE id = ?', [id]);
    }

    /**
     * Update estoque_atual for a product.
     */
    async updateEstoque(id, novoEstoque) {
        return this.execute('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novoEstoque, id]);
    }

    /**
     * Adjust estoque by delta (positive = add, negative = subtract).
     */
    async adjustEstoque(id, delta) {
        return this.execute(
            'UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?',
            [delta, id]
        );
    }
}

module.exports = ProdutoRepository;
