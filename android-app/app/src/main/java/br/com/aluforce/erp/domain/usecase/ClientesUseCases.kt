package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.ClientesRepository
import javax.inject.Inject

class GetClienteDetalheUseCase @Inject constructor(
    private val clientesRepository: ClientesRepository
) {
    suspend operator fun invoke(id: Int): Resource<Cliente> {
        if (id <= 0) return Resource.error("ID do cliente inválido")
        return clientesRepository.getClienteById(id)
    }
}

class CreateClienteUseCase @Inject constructor(
    private val clientesRepository: ClientesRepository
) {
    suspend operator fun invoke(
        nome: String, cnpj: String? = null, cpf: String? = null, email: String? = null,
        telefone: String? = null, endereco: String? = null, cidade: String? = null, estado: String? = null
    ): Resource<Cliente> {
        if (nome.isBlank()) return Resource.error("Nome é obrigatório")
        return clientesRepository.createCliente(nome, cnpj, cpf, email, telefone, endereco, cidade, estado)
    }
}

class GetClientePedidosUseCase @Inject constructor(
    private val clientesRepository: ClientesRepository
) {
    suspend operator fun invoke(clienteId: Int, page: Int = 1): Resource<List<PedidoResumo>> {
        return clientesRepository.getClientePedidos(clienteId, page)
    }
}

class GetClienteHistoricoUseCase @Inject constructor(
    private val clientesRepository: ClientesRepository
) {
    suspend operator fun invoke(clienteId: Int): Resource<List<ClienteHistorico>> {
        return clientesRepository.getClienteHistorico(clienteId)
    }
}
