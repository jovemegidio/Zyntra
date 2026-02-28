package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*

interface FinanceiroRepository {
    // Contas a Pagar
    suspend fun getContasPagar(page: Int = 1, perPage: Int = 20, status: String? = null, search: String? = null): Resource<List<ContaPagar>>
    suspend fun getContaPagarById(id: Int): Resource<ContaPagar>
    suspend fun registrarPagamento(id: Int, valorPago: Double, dataPagamento: String, formaPagamento: String?): Resource<ContaPagar>

    // Contas a Receber
    suspend fun getContasReceber(page: Int = 1, perPage: Int = 20, status: String? = null, search: String? = null): Resource<List<ContaReceber>>
    suspend fun getContaReceberById(id: Int): Resource<ContaReceber>
    suspend fun registrarRecebimento(id: Int, valorRecebido: Double, dataRecebimento: String, formaPagamento: String?): Resource<ContaReceber>

    // Fluxo e Resumo
    suspend fun getFluxoCaixa(dataInicio: String, dataFim: String): Resource<FluxoCaixa>
    suspend fun getResumoFinanceiro(): Resource<ResumoFinanceiro>
}
