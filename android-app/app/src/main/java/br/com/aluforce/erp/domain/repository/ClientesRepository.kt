package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*

interface ClientesRepository {
    suspend fun getClientes(page: Int = 1, perPage: Int = 20, search: String? = null): Resource<List<Cliente>>
    suspend fun getClienteById(id: Int): Resource<Cliente>
    suspend fun createCliente(nome: String, cnpj: String?, cpf: String?, email: String?, telefone: String?, endereco: String?, cidade: String?, estado: String?): Resource<Cliente>
    suspend fun updateCliente(id: Int, nome: String?, email: String?, telefone: String?, endereco: String?, cidade: String?, estado: String?): Resource<Cliente>
    suspend fun getClientePedidos(id: Int, page: Int = 1): Resource<List<PedidoResumo>>
    suspend fun getClienteHistorico(id: Int): Resource<List<ClienteHistorico>>
}
