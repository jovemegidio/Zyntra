package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.ComprasRepository
import javax.inject.Inject

class GetPedidosCompraUseCase @Inject constructor(
    private val comprasRepository: ComprasRepository
) {
    suspend operator fun invoke(
        page: Int = 1, search: String? = null, status: String? = null
    ): Resource<List<PedidoCompraResumo>> {
        return comprasRepository.getPedidosCompra(
            page = page, search = search?.takeIf { it.isNotBlank() }, status = status
        )
    }
}

class GetPedidoCompraDetalheUseCase @Inject constructor(
    private val comprasRepository: ComprasRepository
) {
    suspend operator fun invoke(id: Int): Resource<PedidoCompra> {
        if (id <= 0) return Resource.error("ID do pedido inválido")
        return comprasRepository.getPedidoCompraById(id)
    }
}

class UpdateCompraStatusUseCase @Inject constructor(
    private val comprasRepository: ComprasRepository
) {
    suspend operator fun invoke(id: Int, status: String, observacao: String? = null): Resource<PedidoCompra> {
        val allowed = listOf("pendente", "aprovado", "enviado", "recebido", "cancelado")
        if (status.lowercase() !in allowed) return Resource.error("Status inválido: $status")
        return comprasRepository.updatePedidoCompraStatus(id, status, observacao)
    }
}

class GetFornecedoresUseCase @Inject constructor(
    private val comprasRepository: ComprasRepository
) {
    suspend operator fun invoke(page: Int = 1, search: String? = null): Resource<List<Fornecedor>> {
        return comprasRepository.getFornecedores(page = page, search = search?.takeIf { it.isNotBlank() })
    }
}

class GetFornecedorDetalheUseCase @Inject constructor(
    private val comprasRepository: ComprasRepository
) {
    suspend operator fun invoke(id: Int): Resource<Fornecedor> {
        if (id <= 0) return Resource.error("ID do fornecedor inválido")
        return comprasRepository.getFornecedorById(id)
    }
}
