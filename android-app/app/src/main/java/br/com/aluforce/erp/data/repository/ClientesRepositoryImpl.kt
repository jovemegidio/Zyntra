package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.ClientesApiService
import br.com.aluforce.erp.data.remote.dto.CreateClienteRequest
import br.com.aluforce.erp.data.remote.dto.UpdateClienteRequest
import br.com.aluforce.erp.data.remote.mapper.ClientesMapper.toDomain
import br.com.aluforce.erp.data.remote.mapper.VendasMapper.toDomain
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.ClientesRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ClientesRepositoryImpl @Inject constructor(
    private val clientesApiService: ClientesApiService
) : ClientesRepository {

    override suspend fun getClientes(page: Int, perPage: Int, search: String?): Resource<List<Cliente>> {
        return NetworkErrorHandler.safeApiCall {
            clientesApiService.getClientes(page = page, perPage = perPage, search = search)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getClienteById(id: Int): Resource<Cliente> {
        return NetworkErrorHandler.safeApiCall {
            clientesApiService.getClienteById(id)
        }.map { it.toDomain() }
    }

    override suspend fun createCliente(
        nome: String, cnpj: String?, cpf: String?, email: String?,
        telefone: String?, endereco: String?, cidade: String?, estado: String?
    ): Resource<Cliente> {
        val request = CreateClienteRequest(
            nome = nome, cnpj = cnpj, cpf = cpf, email = email,
            telefone = telefone, endereco = endereco, cidade = cidade, estado = estado
        )
        return NetworkErrorHandler.safeApiCall {
            clientesApiService.createCliente(request)
        }.map { it.toDomain() }
    }

    override suspend fun updateCliente(
        id: Int, nome: String?, email: String?, telefone: String?,
        endereco: String?, cidade: String?, estado: String?
    ): Resource<Cliente> {
        val request = UpdateClienteRequest(
            nome = nome, email = email, telefone = telefone,
            endereco = endereco, cidade = cidade, estado = estado
        )
        return NetworkErrorHandler.safeApiCall {
            clientesApiService.updateCliente(id, request)
        }.map { it.toDomain() }
    }

    override suspend fun getClientePedidos(id: Int, page: Int): Resource<List<PedidoResumo>> {
        return NetworkErrorHandler.safeApiCall {
            clientesApiService.getClientePedidos(id, page)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getClienteHistorico(id: Int): Resource<List<ClienteHistorico>> {
        return NetworkErrorHandler.safeApiCall {
            clientesApiService.getClienteHistorico(id)
        }.map { list -> list.map { it.toDomain() } }
    }
}
