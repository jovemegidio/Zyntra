package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.FinanceiroApiService
import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.data.remote.mapper.FinanceiroMapper.toDomain
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.FinanceiroRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FinanceiroRepositoryImpl @Inject constructor(
    private val financeiroApiService: FinanceiroApiService
) : FinanceiroRepository {

    override suspend fun getContasPagar(
        page: Int, perPage: Int, status: String?, search: String?
    ): Resource<List<ContaPagar>> {
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.getContasPagar(page = page, perPage = perPage, status = status, search = search)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getContaPagarById(id: Int): Resource<ContaPagar> {
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.getContaPagarById(id)
        }.map { it.toDomain() }
    }

    override suspend fun registrarPagamento(
        id: Int, valorPago: Double, dataPagamento: String, formaPagamento: String?
    ): Resource<ContaPagar> {
        val request = PagarContaRequest(valorPago = valorPago, dataPagamento = dataPagamento, formaPagamento = formaPagamento)
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.pagarConta(id, request)
        }.map { it.toDomain() }
    }

    override suspend fun getContasReceber(
        page: Int, perPage: Int, status: String?, search: String?
    ): Resource<List<ContaReceber>> {
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.getContasReceber(page = page, perPage = perPage, status = status, search = search)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getContaReceberById(id: Int): Resource<ContaReceber> {
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.getContaReceberById(id)
        }.map { it.toDomain() }
    }

    override suspend fun registrarRecebimento(
        id: Int, valorRecebido: Double, dataRecebimento: String, formaPagamento: String?
    ): Resource<ContaReceber> {
        val request = ReceberContaRequest(valorRecebido = valorRecebido, dataRecebimento = dataRecebimento, formaPagamento = formaPagamento)
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.receberConta(id, request)
        }.map { it.toDomain() }
    }

    override suspend fun getFluxoCaixa(dataInicio: String, dataFim: String): Resource<FluxoCaixa> {
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.getFluxoCaixa(dataInicio = dataInicio, dataFim = dataFim)
        }.map { it.toDomain() }
    }

    override suspend fun getResumoFinanceiro(): Resource<ResumoFinanceiro> {
        return NetworkErrorHandler.safeApiCall {
            financeiroApiService.getResumoFinanceiro()
        }.map { it.toDomain() }
    }
}
