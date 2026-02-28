package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API service for Financeiro module.
 * Maps to: /api/v1/financeiro/
 */
interface FinanceiroApiService {

    // ========== CONTAS A PAGAR ==========

    @GET("financeiro/contas-pagar")
    suspend fun getContasPagar(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("status") status: String? = null,
        @Query("data_inicio") dataInicio: String? = null,
        @Query("data_fim") dataFim: String? = null,
        @Query("search") search: String? = null,
        @Query("sort") sort: String = "data_vencimento",
        @Query("order") order: String = "asc"
    ): Response<ApiResponse<List<ContaPagarDto>>>

    @GET("financeiro/contas-pagar/{id}")
    suspend fun getContaPagarById(@Path("id") id: Int): Response<ApiResponse<ContaPagarDto>>

    @POST("financeiro/contas-pagar")
    suspend fun createContaPagar(@Body request: CreateContaPagarRequest): Response<ApiResponse<ContaPagarDto>>

    @PATCH("financeiro/contas-pagar/{id}/pagar")
    suspend fun pagarConta(
        @Path("id") id: Int,
        @Body request: PagarContaRequest
    ): Response<ApiResponse<ContaPagarDto>>

    // ========== CONTAS A RECEBER ==========

    @GET("financeiro/contas-receber")
    suspend fun getContasReceber(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("status") status: String? = null,
        @Query("data_inicio") dataInicio: String? = null,
        @Query("data_fim") dataFim: String? = null,
        @Query("search") search: String? = null,
        @Query("sort") sort: String = "data_vencimento",
        @Query("order") order: String = "asc"
    ): Response<ApiResponse<List<ContaReceberDto>>>

    @GET("financeiro/contas-receber/{id}")
    suspend fun getContaReceberById(@Path("id") id: Int): Response<ApiResponse<ContaReceberDto>>

    @POST("financeiro/contas-receber")
    suspend fun createContaReceber(@Body request: CreateContaReceberRequest): Response<ApiResponse<ContaReceberDto>>

    @PATCH("financeiro/contas-receber/{id}/receber")
    suspend fun receberConta(
        @Path("id") id: Int,
        @Body request: ReceberContaRequest
    ): Response<ApiResponse<ContaReceberDto>>

    // ========== FLUXO DE CAIXA ==========

    @GET("financeiro/fluxo-caixa")
    suspend fun getFluxoCaixa(
        @Query("periodo") periodo: String = "month",
        @Query("data_inicio") dataInicio: String? = null,
        @Query("data_fim") dataFim: String? = null
    ): Response<ApiResponse<FluxoCaixaDto>>

    // ========== RESUMO ==========

    @GET("financeiro/resumo")
    suspend fun getResumoFinanceiro(
        @Query("periodo") periodo: String = "month"
    ): Response<ApiResponse<ResumoFinanceiroDto>>
}
