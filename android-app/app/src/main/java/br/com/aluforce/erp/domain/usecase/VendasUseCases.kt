package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.Cliente
import br.com.aluforce.erp.domain.model.Pedido
import br.com.aluforce.erp.domain.model.PedidoResumo
import br.com.aluforce.erp.domain.repository.VendasRepository
import javax.inject.Inject

/**
 * Use case for listing orders with pagination and filters.
 */
class GetPedidosUseCase @Inject constructor(
    private val vendasRepository: VendasRepository
) {
    suspend operator fun invoke(
        page: Int = 1,
        search: String? = null,
        status: String? = null
    ): Resource<List<PedidoResumo>> {
        return vendasRepository.getPedidos(
            page = page,
            search = search?.takeIf { it.isNotBlank() },
            status = status
        )
    }
}

/**
 * Use case for getting order details.
 */
class GetPedidoDetalheUseCase @Inject constructor(
    private val vendasRepository: VendasRepository
) {
    suspend operator fun invoke(id: Int): Resource<Pedido> {
        if (id <= 0) return Resource.error("ID do pedido inválido")
        return vendasRepository.getPedidoById(id)
    }
}

/**
 * Use case for updating order status.
 */
class UpdatePedidoStatusUseCase @Inject constructor(
    private val vendasRepository: VendasRepository
) {
    suspend operator fun invoke(id: Int, status: String, observacao: String? = null): Resource<Pedido> {
        val allowedStatuses = listOf("pendente", "aprovado", "em_producao", "faturado", "entregue", "cancelado")
        if (status.lowercase() !in allowedStatuses) {
            return Resource.error("Status inválido: $status")
        }
        return vendasRepository.updatePedidoStatus(id, status, observacao)
    }
}

/**
 * Use case for listing customers.
 */
class GetClientesUseCase @Inject constructor(
    private val vendasRepository: VendasRepository
) {
    suspend operator fun invoke(
        page: Int = 1,
        search: String? = null
    ): Resource<List<Cliente>> {
        return vendasRepository.getClientes(
            page = page,
            search = search?.takeIf { it.isNotBlank() }
        )
    }
}
