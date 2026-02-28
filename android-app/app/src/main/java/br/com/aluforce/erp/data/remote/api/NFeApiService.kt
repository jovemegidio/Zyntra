package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API service for NFe module.
 * Maps to: /api/v1/nfe/
 */
interface NFeApiService {

    @GET("nfe/notas")
    suspend fun getNotasFiscais(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("status") status: String? = null,
        @Query("tipo") tipo: String? = null,
        @Query("data_inicio") dataInicio: String? = null,
        @Query("data_fim") dataFim: String? = null,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc"
    ): Response<ApiResponse<List<NotaFiscalDto>>>

    @GET("nfe/notas/{id}")
    suspend fun getNotaFiscalById(@Path("id") id: Int): Response<ApiResponse<NotaFiscalDto>>

    @POST("nfe/emitir")
    suspend fun emitirNFe(@Body request: EmitirNFeRequest): Response<ApiResponse<NotaFiscalDto>>

    @POST("nfe/notas/{id}/cancelar")
    suspend fun cancelarNFe(
        @Path("id") id: Int,
        @Body request: CancelarNFeRequest
    ): Response<ApiResponse<NotaFiscalDto>>

    @GET("nfe/notas/{id}/danfe")
    suspend fun getDanfeUrl(@Path("id") id: Int): Response<ApiResponse<DanfeUrlDto>>

    @GET("nfe/notas/{id}/xml")
    suspend fun getXmlUrl(@Path("id") id: Int): Response<ApiResponse<XmlUrlDto>>

    @GET("nfe/resumo")
    suspend fun getResumoNFe(
        @Query("periodo") periodo: String = "month"
    ): Response<ApiResponse<ResumoNFeDto>>
}
