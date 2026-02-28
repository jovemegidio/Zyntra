package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.NFeApiService
import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.data.remote.mapper.NFeMapper.toDomain
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.NFeRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NFeRepositoryImpl @Inject constructor(
    private val nfeApiService: NFeApiService
) : NFeRepository {

    override suspend fun getNotasFiscais(
        page: Int, perPage: Int, status: String?, search: String?, tipo: String?
    ): Resource<List<NotaFiscal>> {
        return NetworkErrorHandler.safeApiCall {
            nfeApiService.getNotasFiscais(page = page, perPage = perPage, status = status, search = search, tipo = tipo)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getNotaFiscalById(id: Int): Resource<NotaFiscal> {
        return NetworkErrorHandler.safeApiCall {
            nfeApiService.getNotaFiscalById(id)
        }.map { it.toDomain() }
    }

    override suspend fun emitirNotaFiscal(
        pedidoId: Int, naturezaOperacao: String?, observacoes: String?
    ): Resource<NotaFiscal> {
        val request = EmitirNFeRequest(pedidoId = pedidoId, naturezaOperacao = naturezaOperacao ?: "VENDA", observacoes = observacoes)
        return NetworkErrorHandler.safeApiCall {
            nfeApiService.emitirNFe(request)
        }.map { it.toDomain() }
    }

    override suspend fun cancelarNotaFiscal(id: Int, motivo: String): Resource<NotaFiscal> {
        val request = CancelarNFeRequest(justificativa = motivo)
        return NetworkErrorHandler.safeApiCall {
            nfeApiService.cancelarNFe(id, request)
        }.map { it.toDomain() }
    }

    override suspend fun getDanfeUrl(id: Int): Resource<String> {
        return NetworkErrorHandler.safeApiCall {
            nfeApiService.getDanfeUrl(id)
        }.map { it.url }
    }

    override suspend fun getXmlUrl(id: Int): Resource<String> {
        return NetworkErrorHandler.safeApiCall {
            nfeApiService.getXmlUrl(id)
        }.map { it.url }
    }
}
