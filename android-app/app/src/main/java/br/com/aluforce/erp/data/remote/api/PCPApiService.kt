package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API service for PCP (Producao) module.
 * Maps to: /api/v1/pcp/
 */
interface PCPApiService {

    // ========== ORDENS DE PRODUCAO ==========

    @GET("pcp/ordens")
    suspend fun getOrdens(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("status") status: String? = null,
        @Query("prioridade") prioridade: String? = null,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc"
    ): Response<ApiResponse<List<OrdemProducaoListDto>>>

    @GET("pcp/ordens/{id}")
    suspend fun getOrdemById(@Path("id") id: Int): Response<ApiResponse<OrdemProducaoDetalheDto>>

    @POST("pcp/ordens")
    suspend fun createOrdem(@Body request: CreateOrdemRequest): Response<ApiResponse<OrdemProducaoDetalheDto>>

    @PATCH("pcp/ordens/{id}/status")
    suspend fun updateOrdemStatus(
        @Path("id") id: Int,
        @Body request: UpdateStatusRequest
    ): Response<ApiResponse<OrdemProducaoDetalheDto>>

    // ========== APONTAMENTOS ==========

    @GET("pcp/ordens/{ordemId}/apontamentos")
    suspend fun getApontamentos(
        @Path("ordemId") ordemId: Int,
        @Query("page") page: Int = 1
    ): Response<ApiResponse<List<ApontamentoDto>>>

    @POST("pcp/apontamentos")
    suspend fun createApontamento(@Body request: CreateApontamentoRequest): Response<ApiResponse<ApontamentoDto>>

    // ========== KANBAN ==========

    @GET("pcp/kanban")
    suspend fun getKanban(): Response<ApiResponse<List<KanbanColumnDto>>>

    // ========== DASHBOARD PCP ==========

    @GET("pcp/dashboard")
    suspend fun getDashboardPCP(): Response<ApiResponse<DashboardPCPDto>>
}
