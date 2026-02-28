package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.PaginatedResult
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.Cliente
import br.com.aluforce.erp.domain.model.Pedido
import br.com.aluforce.erp.domain.model.PedidoResumo

/**
 * Vendas (Sales) repository interface (Domain layer).
 */
interface VendasRepository {

    // ========== PEDIDOS ==========

    suspend fun getPedidos(
        page: Int = 1,
        perPage: Int = 20,
        search: String? = null,
        status: String? = null,
        sort: String = "created_at",
        order: String = "desc"
    ): Resource<List<PedidoResumo>>

    suspend fun getPedidoById(id: Int): Resource<Pedido>

    suspend fun createPedido(pedido: Pedido): Resource<Pedido>

    suspend fun updatePedidoStatus(id: Int, status: String, observacao: String?): Resource<Pedido>

    // ========== CLIENTES ==========

    suspend fun getClientes(
        page: Int = 1,
        perPage: Int = 20,
        search: String? = null
    ): Resource<List<Cliente>>

    suspend fun getClienteById(id: Int): Resource<Cliente>
}
