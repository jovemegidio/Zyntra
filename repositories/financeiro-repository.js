/**
 * Financeiro Repository — encapsulates contas_pagar / contas_receber queries.
 * @module repositories/financeiro-repository
 */
const BaseRepository = require('./base-repository');

class FinanceiroRepository extends BaseRepository {
    // ===== CONTAS A RECEBER =====

    async totalReceberPendente() {
        const row = await this.queryOne(
            "SELECT COALESCE(SUM(valor), 0) AS total FROM contas_receber WHERE status != 'pago'"
        );
        return parseFloat(row.total);
    }

    async listContasReceber(filters = {}) {
        let where = 'WHERE 1=1';
        const params = [];
        if (filters.status) { where += ' AND cr.status = ?'; params.push(filters.status); }
        if (filters.empresa_id) { where += ' AND cr.empresa_id = ?'; params.push(filters.empresa_id); }
        if (filters.dataInicio) { where += ' AND cr.data_vencimento >= ?'; params.push(filters.dataInicio); }
        if (filters.dataFim) { where += ' AND cr.data_vencimento <= ?'; params.push(filters.dataFim); }

        return this.query(
            `SELECT cr.*, c.nome_fantasia AS cliente_nome
             FROM contas_receber cr
             LEFT JOIN clientes c ON cr.cliente_id = c.id
             ${where} ORDER BY cr.data_vencimento ASC`,
            params
        );
    }

    async marcarRecebido(id) {
        return this.execute(
            "UPDATE contas_receber SET status = 'pago', data_pagamento = NOW() WHERE id = ?",
            [id]
        );
    }

    // ===== CONTAS A PAGAR =====

    async totalPagarPendente() {
        const row = await this.queryOne(
            "SELECT COALESCE(SUM(valor), 0) AS total FROM contas_pagar WHERE status != 'pago'"
        );
        return parseFloat(row.total);
    }

    async listContasPagar(filters = {}) {
        let where = 'WHERE 1=1';
        const params = [];
        if (filters.status) { where += ' AND cp.status = ?'; params.push(filters.status); }
        if (filters.empresa_id) { where += ' AND cp.empresa_id = ?'; params.push(filters.empresa_id); }
        if (filters.dataInicio) { where += ' AND cp.data_vencimento >= ?'; params.push(filters.dataInicio); }
        if (filters.dataFim) { where += ' AND cp.data_vencimento <= ?'; params.push(filters.dataFim); }

        return this.query(
            `SELECT cp.*, f.razao_social AS fornecedor_nome
             FROM contas_pagar cp
             LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
             ${where} ORDER BY cp.data_vencimento ASC`,
            params
        );
    }

    async marcarPago(id) {
        return this.execute(
            "UPDATE contas_pagar SET status = 'pago', data_pagamento = NOW() WHERE id = ?",
            [id]
        );
    }

    // ===== DASHBOARD KPIs =====

    async dashboardKPIs() {
        const [receber, pagar] = await Promise.all([
            this.totalReceberPendente(),
            this.totalPagarPendente()
        ]);
        return { totalReceber: receber, totalPagar: pagar, saldo: receber - pagar };
    }
}

module.exports = FinanceiroRepository;
