package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.PCPApiService
import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.data.remote.mapper.PCPMapper.toDomain
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.DashboardPCP
import br.com.aluforce.erp.domain.repository.PCPRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PCPRepositoryImpl @Inject constructor(
    private val pcpApiService: PCPApiService
) : PCPRepository {

    override suspend fun getOrdens(
        page: Int, perPage: Int, search: String?, status: String?
    ): Resource<List<OrdemProducaoResumo>> {
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.getOrdens(page = page, perPage = perPage, search = search, status = status)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getOrdemById(id: Int): Resource<OrdemProducao> {
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.getOrdemById(id)
        }.map { it.toDomain() }
    }

    override suspend fun createOrdem(
        produto: String, produtoId: Int?, quantidade: Double,
        prioridade: String?, dataPrevisao: String?, observacoes: String?
    ): Resource<OrdemProducao> {
        val request = CreateOrdemRequest(
            produto = produto, produtoId = produtoId, quantidade = quantidade,
            prioridade = prioridade ?: "normal", dataPrevisao = dataPrevisao, observacoes = observacoes
        )
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.createOrdem(request)
        }.map { it.toDomain() }
    }

    override suspend fun updateOrdemStatus(id: Int, status: String, observacao: String?): Resource<OrdemProducao> {
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.updateOrdemStatus(id, UpdateStatusRequest(status, observacao))
        }.map { it.toDomain() }
    }

    override suspend fun getApontamentos(ordemId: Int, page: Int): Resource<List<Apontamento>> {
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.getApontamentos(ordemId, page)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun createApontamento(
        ordemId: Int, tipo: String, quantidade: Double, observacao: String?
    ): Resource<Apontamento> {
        val request = CreateApontamentoRequest(ordemId = ordemId, tipo = tipo, quantidade = quantidade, observacao = observacao)
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.createApontamento(request)
        }.map { it.toDomain() }
    }

    override suspend fun getDashboardPCP(): Resource<DashboardPCP> {
        return NetworkErrorHandler.safeApiCall {
            pcpApiService.getDashboardPCP()
        }.map {
            DashboardPCP(
                ordensAtivas = it.ordensAtivas,
                ordensAtrasadas = it.ordensAtrasadas,
                producaoHoje = it.producaoHoje.toDouble(),
                eficiencia = it.eficiencia ?: 0.0,
                ordensPorStatus = it.porStatus ?: emptyMap()
            )
        }
    }
}
