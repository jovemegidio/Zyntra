package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API service for Clientes module.
 * Maps to: /api/v1/clientes/
 */
interface ClientesApiService {

    @GET("clientes")
    suspend fun getClientes(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("status") status: String? = null,
        @Query("segmento") segmento: String? = null,
        @Query("sort") sort: String = "nome",
        @Query("order") order: String = "asc"
    ): Response<ApiResponse<List<ClienteDto>>>

    @GET("clientes/{id}")
    suspend fun getClienteById(@Path("id") id: Int): Response<ApiResponse<ClienteDto>>

    @POST("clientes")
    suspend fun createCliente(@Body request: CreateClienteRequest): Response<ApiResponse<ClienteDto>>

    @PUT("clientes/{id}")
    suspend fun updateCliente(
        @Path("id") id: Int,
        @Body request: UpdateClienteRequest
    ): Response<ApiResponse<ClienteDto>>

    @GET("clientes/{id}/pedidos")
    suspend fun getClientePedidos(
        @Path("id") id: Int,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20
    ): Response<ApiResponse<List<PedidoListDto>>>

    @GET("clientes/{id}/historico")
    suspend fun getClienteHistorico(
        @Path("id") id: Int
    ): Response<ApiResponse<List<HistoricoClienteDto>>>
}
