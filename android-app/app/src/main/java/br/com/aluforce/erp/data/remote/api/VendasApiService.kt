package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.ClienteDto
import br.com.aluforce.erp.data.remote.dto.CreatePedidoRequest
import br.com.aluforce.erp.data.remote.dto.PedidoDetalheDto
import br.com.aluforce.erp.data.remote.dto.PedidoListDto
import br.com.aluforce.erp.data.remote.dto.UpdatePedidoStatusRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit service for Vendas (Sales) module endpoints.
 * Maps to: /api/v1/vendas/
 */
interface VendasApiService {

    // ========== PEDIDOS (ORDERS) ==========

    /**
     * List orders with pagination and filters.
     * GET /api/v1/vendas/pedidos
     */
    @GET("vendas/pedidos")
    suspend fun getPedidos(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc",
        @Query("search") search: String? = null,
        @Query("status") status: String? = null,
        @Query("cliente_id") clienteId: Int? = null,
        @Query("date_from") dateFrom: String? = null,
        @Query("date_to") dateTo: String? = null
    ): Response<ApiResponse<List<PedidoListDto>>>

    /**
     * Get order details by ID.
     * GET /api/v1/vendas/pedidos/{id}
     */
    @GET("vendas/pedidos/{id}")
    suspend fun getPedidoById(
        @Path("id") id: Int
    ): Response<ApiResponse<PedidoDetalheDto>>

    /**
     * Create a new order.
     * POST /api/v1/vendas/pedidos
     */
    @POST("vendas/pedidos")
    suspend fun createPedido(
        @Body request: CreatePedidoRequest
    ): Response<ApiResponse<PedidoDetalheDto>>

    /**
     * Update order status.
     * PATCH /api/v1/vendas/pedidos/{id}/status
     */
    @PATCH("vendas/pedidos/{id}/status")
    suspend fun updatePedidoStatus(
        @Path("id") id: Int,
        @Body request: UpdatePedidoStatusRequest
    ): Response<ApiResponse<PedidoDetalheDto>>

    // ========== CLIENTES (CUSTOMERS) ==========

    /**
     * List customers with pagination and search.
     * GET /api/v1/vendas/clientes
     */
    @GET("vendas/clientes")
    suspend fun getClientes(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("search") search: String? = null,
        @Query("sort") sort: String = "nome",
        @Query("order") order: String = "asc"
    ): Response<ApiResponse<List<ClienteDto>>>

    /**
     * Get customer details by ID.
     * GET /api/v1/vendas/clientes/{id}
     */
    @GET("vendas/clientes/{id}")
    suspend fun getClienteById(
        @Path("id") id: Int
    ): Response<ApiResponse<ClienteDto>>
}
