package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API service for RH module.
 * Maps to: /api/v1/rh/
 */
interface RHApiService {

    // ========== FUNCIONARIOS ==========

    @GET("rh/funcionarios")
    suspend fun getFuncionarios(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("departamento") departamento: String? = null,
        @Query("status") status: String? = null,
        @Query("sort") sort: String = "nome",
        @Query("order") order: String = "asc"
    ): Response<ApiResponse<List<FuncionarioDto>>>

    @GET("rh/funcionarios/{id}")
    suspend fun getFuncionarioById(@Path("id") id: Int): Response<ApiResponse<FuncionarioDto>>

    @POST("rh/funcionarios")
    suspend fun createFuncionario(@Body request: CreateFuncionarioRequest): Response<ApiResponse<FuncionarioDto>>

    @PUT("rh/funcionarios/{id}")
    suspend fun updateFuncionario(
        @Path("id") id: Int,
        @Body request: UpdateFuncionarioRequest
    ): Response<ApiResponse<FuncionarioDto>>

    // ========== PONTO ==========

    @GET("rh/ponto")
    suspend fun getRegistrosPonto(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("funcionario_id") funcionarioId: Int? = null,
        @Query("data_inicio") dataInicio: String? = null,
        @Query("data_fim") dataFim: String? = null
    ): Response<ApiResponse<List<RegistroPontoDto>>>

    @POST("rh/ponto")
    suspend fun registrarPonto(@Body request: RegistrarPontoRequest): Response<ApiResponse<RegistroPontoDto>>

    @GET("rh/ponto/hoje")
    suspend fun getPontoHoje(): Response<ApiResponse<RegistroPontoDto>>

    // ========== HOLERITES ==========

    @GET("rh/holerites")
    suspend fun getHolerites(
        @Query("funcionario_id") funcionarioId: Int? = null,
        @Query("ano") ano: Int? = null
    ): Response<ApiResponse<List<HoleriteDto>>>

    @GET("rh/holerites/{id}")
    suspend fun getHoleriteById(@Path("id") id: Int): Response<ApiResponse<HoleriteDto>>

    // ========== DEPARTAMENTOS ==========

    @GET("rh/departamentos")
    suspend fun getDepartamentos(): Response<ApiResponse<List<DepartamentoDto>>>
}
