package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*

interface PCPRepository {
    suspend fun getOrdens(page: Int = 1, perPage: Int = 20, search: String? = null, status: String? = null): Resource<List<OrdemProducaoResumo>>
    suspend fun getOrdemById(id: Int): Resource<OrdemProducao>
    suspend fun createOrdem(produto: String, produtoId: Int?, quantidade: Double, prioridade: String?, dataPrevisao: String?, observacoes: String?): Resource<OrdemProducao>
    suspend fun updateOrdemStatus(id: Int, status: String, observacao: String?): Resource<OrdemProducao>
    suspend fun getApontamentos(ordemId: Int, page: Int = 1): Resource<List<Apontamento>>
    suspend fun createApontamento(ordemId: Int, tipo: String, quantidade: Double, observacao: String?): Resource<Apontamento>
    suspend fun getDashboardPCP(): Resource<DashboardPCP>
}

data class DashboardPCP(
    val ordensAtivas: Int = 0,
    val ordensAtrasadas: Int = 0,
    val producaoHoje: Double = 0.0,
    val eficiencia: Double = 0.0,
    val ordensPorStatus: Map<String, Int> = emptyMap()
)
