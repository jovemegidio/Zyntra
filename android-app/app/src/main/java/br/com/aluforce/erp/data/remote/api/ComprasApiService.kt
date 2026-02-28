package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API service for Compras module.
 * Maps to: /api/v1/compras/
 */
interface ComprasApiService {

    // ========== PEDIDOS DE COMPRA ==========

    @GET("compras/pedidos")
    suspend fun getPedidosCompra(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("status") status: String? = null,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc"
    ): Response<ApiResponse<List<PedidoCompraListDto>>>

    @GET("compras/pedidos/{id}")
    suspend fun getPedidoCompraById(@Path("id") id: Int): Response<ApiResponse<PedidoCompraDetalheDto>>

    @POST("compras/pedidos")
    suspend fun createPedidoCompra(@Body request: CreatePedidoCompraRequest): Response<ApiResponse<PedidoCompraDetalheDto>>

    @PATCH("compras/pedidos/{id}/status")
    suspend fun updatePedidoCompraStatus(
        @Path("id") id: Int,
        @Body request: UpdateStatusRequest
    ): Response<ApiResponse<PedidoCompraDetalheDto>>

    // ========== FORNECEDORES ==========

    @GET("compras/fornecedores")
    suspend fun getFornecedores(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("status") status: String? = null
    ): Response<ApiResponse<List<FornecedorDto>>>

    @GET("compras/fornecedores/{id}")
    suspend fun getFornecedorById(@Path("id") id: Int): Response<ApiResponse<FornecedorDto>>

    @POST("compras/fornecedores")
    suspend fun createFornecedor(@Body request: CreateFornecedorRequest): Response<ApiResponse<FornecedorDto>>

    @PUT("compras/fornecedores/{id}")
    suspend fun updateFornecedor(
        @Path("id") id: Int,
        @Body request: UpdateFornecedorRequest
    ): Response<ApiResponse<FornecedorDto>>

    // ========== COTACOES ==========

    @GET("compras/cotacoes")
    suspend fun getCotacoes(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("status") status: String? = null
    ): Response<ApiResponse<List<CotacaoDto>>>
}
