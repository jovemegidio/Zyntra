/**
 * Pedido Repository - encapsulates pedidos-related SQL queries.
 * @module repositories/pedido-repository
 */
const BaseRepository = require('./base-repository');

const OPTIONAL_TABLE_ERRORS = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_TABLE_ERROR']);

class PedidoRepository extends BaseRepository {
    constructor(pool) {
        super(pool);
        this.columnsCache = new Map();
    }

    async getColumns(tableName) {
        if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
            throw new Error('Nome de tabela invalido');
        }

        if (this.columnsCache.has(tableName)) {
            return this.columnsCache.get(tableName);
        }

        try {
            const [rows] = await this.pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
            const columns = new Set(rows.map(row => row.Field));
            this.columnsCache.set(tableName, columns);
            return columns;
        } catch (err) {
            if (OPTIONAL_TABLE_ERRORS.has(err.code)) {
                const columns = new Set();
                this.columnsCache.set(tableName, columns);
                return columns;
            }
            throw err;
        }
    }

    col(alias, column) {
        return `${alias}.\`${column}\``;
    }

    selectColumn(alias, columns, column, outputAlias, fallback = 'NULL') {
        return columns.has(column)
            ? `${this.col(alias, column)} AS \`${outputAlias || column}\``
            : `${fallback} AS \`${outputAlias || column}\``;
    }

    firstExistingExpression(alias, columns, candidates) {
        const existing = candidates.filter(column => columns.has(column));
        if (!existing.length) return null;
        if (existing.length === 1) return this.col(alias, existing[0]);
        return `COALESCE(${existing.map(column => this.col(alias, column)).join(', ')})`;
    }

    selectFirst(alias, columns, candidates, outputAlias, fallback = 'NULL') {
        const expr = this.firstExistingExpression(alias, columns, candidates);
        return `${expr || fallback} AS \`${outputAlias}\``;
    }

    selectCoalesce(expressions, outputAlias, fallback = 'NULL') {
        const usable = expressions.filter(Boolean);
        if (!usable.length) return `${fallback} AS \`${outputAlias}\``;
        return `COALESCE(${usable.join(', ')}, ${fallback}) AS \`${outputAlias}\``;
    }

    async buildPedidoParts({ detail = false } = {}) {
        const p = await this.getColumns('pedidos');
        const c = await this.getColumns('clientes');
        const e = await this.getColumns('empresas');
        const u = await this.getColumns('usuarios');
        const t = detail ? await this.getColumns('transportadoras') : new Set();

        const joins = ['FROM pedidos p'];
        const hasClientes = p.has('cliente_id') && c.has('id');
        const hasEmpresas = p.has('empresa_id') && e.has('id');
        const hasUsuarios = p.has('vendedor_id') && u.has('id');
        const hasTransportadoras = detail && p.has('transportadora_id') && t.has('id');

        if (hasClientes) joins.push('LEFT JOIN clientes c ON p.cliente_id = c.id');
        if (hasEmpresas) joins.push('LEFT JOIN empresas e ON p.empresa_id = e.id');
        if (hasUsuarios) joins.push('LEFT JOIN usuarios u ON p.vendedor_id = u.id');
        if (hasTransportadoras) joins.push('LEFT JOIN transportadoras t ON p.transportadora_id = t.id');

        const pedidoDataExpr = this.firstExistingExpression('p', p, ['created_at', 'data_pedido', 'data_criacao', 'data']);
        const valorExpr = this.firstExistingExpression('p', p, ['valor', 'valor_total', 'total', 'total_geral']) || '0';
        const numeroExpr = this.firstExistingExpression('p', p, ['numero_pedido', 'numero', 'id']) || 'NULL';
        const clienteExprs = [
            hasClientes ? this.firstExistingExpression('c', c, ['nome_fantasia', 'razao_social', 'nome']) : null,
            this.firstExistingExpression('p', p, ['cliente_nome', 'cliente', 'nome_cliente', 'razao_social_cliente'])
        ];
        // Preferir o nome do vendedor GRAVADO no pedido (autoritativo) sobre o JOIN por vendedor_id.
        // O vendedor_id pode resolver para um usuario duplicado/errado (ex.: pedidos do Augusto
        // saindo com nome de Fabiano). NULLIF garante que um vendedor_nome vazio caia no JOIN.
        // Mantem consistencia com o endpoint de detalhe (COALESCE(p.vendedor_nome, u.nome)).
        const vendedorStoredExpr = this.firstExistingExpression('p', p, ['vendedor_nome', 'nome_vendedor']);
        const vendedorJoinExpr = hasUsuarios ? this.firstExistingExpression('u', u, ['nome', 'name']) : null;
        const vendedorExprs = [
            vendedorStoredExpr ? `NULLIF(${vendedorStoredExpr}, '')` : null,
            vendedorJoinExpr
        ];
        const empresaExprs = [
            hasEmpresas ? this.firstExistingExpression('e', e, ['nome_fantasia', 'razao_social', 'nome']) : null,
            this.firstExistingExpression('p', p, ['empresa_nome'])
        ];

        const listSelect = [
            this.selectColumn('p', p, 'id', 'id'),
            `${numeroExpr} AS \`numero_pedido\``,
            `${valorExpr} AS \`valor\``,
            `${valorExpr} AS \`valor_total\``,
            this.selectColumn('p', p, 'status', 'status', "'orcamento'"),
            `${pedidoDataExpr || 'NULL'} AS \`created_at\``,
            `${pedidoDataExpr || 'NULL'} AS \`data_pedido\``,
            this.selectColumn('p', p, 'vendedor_id', 'vendedor_id'),
            this.selectColumn('p', p, 'cliente_id', 'cliente_id'),
            this.selectFirst('p', p, ['observacao', 'observacoes', 'obs'], 'observacao'),
            this.selectFirst('p', p, ['condicao_pagamento', 'condicoes_pagamento'], 'condicao_pagamento'),
            this.selectFirst('p', p, ['parcelas', 'qtd_parcelas', 'numero_parcelas'], 'parcelas'),
            this.selectColumn('p', p, 'nf', 'nf'),
            this.selectColumn('p', p, 'numero_nf', 'numero_nf'),
            this.selectColumn('p', p, 'nfe_chave', 'nfe_chave'),
            this.selectColumn('p', p, 'version', 'version', '1'),
            `${numeroExpr} AS \`numero\``,
            this.selectCoalesce(clienteExprs, 'cliente_nome', "'Cliente nao informado'"),
            hasClientes ? this.selectFirst('c', c, ['email', 'email_principal'], 'cliente_email') : 'NULL AS `cliente_email`',
            hasClientes ? this.selectFirst('c', c, ['telefone', 'celular', 'fone'], 'cliente_telefone') : 'NULL AS `cliente_telefone`',
            this.selectCoalesce(empresaExprs, 'empresa_nome'),
            this.selectCoalesce(vendedorExprs, 'vendedor_nome')
        ];

        const detailSelect = detail ? [
            'p.*',
            `${valorExpr} AS \`valor_total\``,
            `${pedidoDataExpr || 'NULL'} AS \`data_pedido\``,
            this.selectColumn('p', p, 'transportadora_id', 'transportadora_id'),
            this.selectFirst('p', p, ['transportadora_nome', 'nome_transportadora'], 'transportadora_nome'),
            this.selectCoalesce(clienteExprs, 'cliente_nome', "'Cliente nao informado'"),
            hasClientes ? this.selectFirst('c', c, ['email', 'email_principal'], 'cliente_email') : 'NULL AS `cliente_email`',
            hasClientes ? this.selectFirst('c', c, ['telefone', 'celular', 'fone'], 'cliente_telefone') : 'NULL AS `cliente_telefone`',
            this.selectCoalesce(empresaExprs, 'empresa_nome'),
            hasEmpresas ? this.selectFirst('e', e, ['razao_social', 'nome_fantasia', 'nome'], 'empresa_razao_social') : 'NULL AS `empresa_razao_social`',
            this.selectCoalesce(vendedorExprs, 'vendedor_nome'),
            hasTransportadoras ? this.selectFirst('t', t, ['razao_social', 'nome_fantasia', 'nome'], 'transp_razao_social') : 'NULL AS `transp_razao_social`',
            hasTransportadoras ? this.selectFirst('t', t, ['cnpj_cpf', 'cnpj', 'cpf'], 'transp_cnpj') : 'NULL AS `transp_cnpj`',
            hasTransportadoras ? this.selectFirst('t', t, ['telefone', 'celular'], 'transp_telefone') : 'NULL AS `transp_telefone`',
            hasTransportadoras ? this.selectColumn('t', t, 'email', 'transp_email') : 'NULL AS `transp_email`',
            hasTransportadoras ? this.selectColumn('t', t, 'cidade', 'transp_cidade') : 'NULL AS `transp_cidade`',
            hasTransportadoras ? this.selectFirst('t', t, ['estado', 'uf'], 'transp_estado') : 'NULL AS `transp_estado`',
            hasTransportadoras ? this.selectColumn('t', t, 'bairro', 'transp_bairro') : 'NULL AS `transp_bairro`',
            hasTransportadoras ? this.selectColumn('t', t, 'cep', 'transp_cep') : 'NULL AS `transp_cep`',
            hasTransportadoras ? this.selectFirst('t', t, ['endereco', 'logradouro'], 'transp_endereco') : 'NULL AS `transp_endereco`'
        ] : listSelect;

        return {
            pedidoColumns: p,
            clienteColumns: c,
            empresaColumns: e,
            usuarioColumns: u,
            joins: joins.join('\n    '),
            select: (detail ? detailSelect : listSelect).join(',\n    '),
            pedidoDataExpr,
            clienteBuscaExpr: this.selectableSearchExpression(clienteExprs),
            empresaBuscaExpr: this.selectableSearchExpression(empresaExprs),
            vendedorBuscaExpr: this.selectableSearchExpression(vendedorExprs)
        };
    }

    selectableSearchExpression(expressions) {
        const usable = expressions.filter(Boolean);
        if (!usable.length) return "''";
        return usable.length === 1 ? `COALESCE(${usable[0]}, '')` : `COALESCE(${usable.join(', ')}, '')`;
    }

    activePedidoConditions(parts) {
        const conditions = [];
        const p = parts.pedidoColumns;

        if (p.has('status')) {
            conditions.push("LOWER(COALESCE(p.`status`, '')) NOT IN ('excluido')");
            conditions.push("LOWER(COALESCE(p.`status`, '')) NOT LIKE 'exclu%'");
        }

        if (p.has('deleted_at')) {
            conditions.push("(p.`deleted_at` IS NULL OR CAST(p.`deleted_at` AS CHAR) = '0000-00-00 00:00:00')");
        }

        conditions.push(`UPPER(${parts.clienteBuscaExpr}) NOT LIKE '%TESTE%'`);
        return conditions;
    }

    /**
     * List pedidos with optional period filter and pagination.
     * Non-admin users only see their own pedidos when the schema supports it.
     * @param {Object} options - { period, page, limit, userId, isAdmin, status }
     */
    async list({ period, page = 1, limit = 1000, userId, isAdmin, status } = {}) {
        const parts = await this.buildPedidoParts();
        const conditions = this.activePedidoConditions(parts);
        const params = [];

        if (period && period !== 'all' && parts.pedidoDataExpr) {
            conditions.push(`${parts.pedidoDataExpr} >= CURDATE() - INTERVAL ? DAY`);
            params.push(parseInt(period, 10) || 0);
        }

        if (userId && !isAdmin && parts.pedidoColumns.has('vendedor_id')) {
            conditions.push('p.`vendedor_id` = ?');
            params.push(userId);
        }

        if (status && status !== 'all' && parts.pedidoColumns.has('status')) {
            conditions.push('p.`status` = ?');
            params.push(status);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 1000, 5000));
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        params.push(safeLimit, (safePage - 1) * safeLimit);

        return this.query(
            `SELECT ${parts.select}
             ${parts.joins}
             ${whereClause}
             ORDER BY p.\`id\` DESC
             LIMIT ? OFFSET ?`,
            params
        );
    }

    /**
     * Search pedidos by client name, empresa name, pedido id, or vendedor name.
     */
    async search(q) {
        const parts = await this.buildPedidoParts();
        const conditions = this.activePedidoConditions(parts);
        const like = `%${q}%`;
        const searchClauses = [
            `${parts.clienteBuscaExpr} LIKE ?`,
            `${parts.empresaBuscaExpr} LIKE ?`,
            `${parts.vendedorBuscaExpr} LIKE ?`,
            'CAST(p.`id` AS CHAR) LIKE ?'
        ];

        if (parts.pedidoColumns.has('numero_pedido')) searchClauses.push('CAST(p.`numero_pedido` AS CHAR) LIKE ?');
        if (parts.pedidoColumns.has('numero_nf')) searchClauses.push('CAST(p.`numero_nf` AS CHAR) LIKE ?');

        conditions.push('(' + searchClauses.join(' OR ') + ')');
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        return this.query(
            `SELECT ${parts.select}
             ${parts.joins}
             ${whereClause}
             ORDER BY p.\`id\` DESC`,
            searchClauses.map(() => like)
        );
    }

    /**
     * Get a single pedido with full detail (including transportadora).
     */
    async findById(id) {
        const parts = await this.buildPedidoParts({ detail: true });
        return this.queryOne(
            `SELECT ${parts.select}
             ${parts.joins}
             WHERE p.\`id\` = ?`,
            [id]
        );
    }

    /**
     * Update pedido status.
     */
    async updateStatus(id, status) {
        const columns = await this.getColumns('pedidos');
        if (!columns.has('status')) {
            return this.execute('UPDATE pedidos SET id = id WHERE id = ?', [id]);
        }
        return this.execute('UPDATE pedidos SET `status` = ? WHERE id = ?', [status, id]);
    }

    /**
     * Update pedido valor.
     */
    async updateValor(id, valor) {
        const columns = await this.getColumns('pedidos');
        const column = ['valor', 'valor_total', 'total', 'total_geral'].find(name => columns.has(name));
        if (!column) {
            return this.execute('UPDATE pedidos SET id = id WHERE id = ?', [id]);
        }
        return this.execute(`UPDATE pedidos SET \`${column}\` = ? WHERE id = ?`, [valor, id]);
    }

    /**
     * Soft-delete a pedido.
     */
    async delete(id) {
        const columns = await this.getColumns('pedidos');
        const sets = [];
        const params = [];

        if (columns.has('status')) {
            sets.push("`status` = 'excluido'");
        }

        if (columns.has('deleted_at')) {
            sets.push('`deleted_at` = NOW()');
        }

        if (!sets.length) {
            return this.execute('UPDATE pedidos SET id = id WHERE id = ?', [id]);
        }

        params.push(id);
        return this.execute(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, params);
    }

    /**
     * Get pedido itens.
     */
    async getItens(pedidoId) {
        const columns = await this.getColumns('pedido_itens');
        if (!columns.size || !columns.has('pedido_id')) return [];

        const select = [
            this.selectColumn('pi', columns, 'id', 'id'),
            this.selectColumn('pi', columns, 'pedido_id', 'pedido_id'),
            this.selectFirst('pi', columns, ['codigo', 'produto_codigo', 'cod_produto'], 'codigo'),
            this.selectFirst('pi', columns, ['descricao', 'produto_descricao', 'nome'], 'descricao'),
            this.selectColumn('pi', columns, 'quantidade', 'quantidade', '0'),
            this.selectColumn('pi', columns, 'quantidade_parcial', 'quantidade_parcial', '0'),
            this.selectFirst('pi', columns, ['unidade', 'unidade_medida'], 'unidade'),
            this.selectFirst('pi', columns, ['local_estoque', 'estoque_local'], 'local_estoque'),
            this.selectFirst('pi', columns, ['preco_unitario', 'valor_unitario', 'preco'], 'preco_unitario', '0'),
            this.selectColumn('pi', columns, 'desconto', 'desconto', '0'),
            this.selectFirst('pi', columns, ['subtotal', 'valor_total', 'total'], 'subtotal', '0')
        ].join(',\n    ');

        return this.query(
            `SELECT ${select}
             FROM pedido_itens pi
             WHERE pi.\`pedido_id\` = ?
             ORDER BY pi.\`id\` ASC`,
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
