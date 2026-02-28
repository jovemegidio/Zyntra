package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.ComprasApiService
import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.data.remote.mapper.ComprasMapper.toDomain
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.ComprasRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ComprasRepositoryImpl @Inject constructor(
    private val comprasApiService: ComprasApiService
) : ComprasRepository {

    override suspend fun getPedidosCompra(
        page: Int, perPage: Int, search: String?, status: String?
    ): Resource<List<PedidoCompraResumo>> {
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.getPedidosCompra(page = page, perPage = perPage, search = search, status = status)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getPedidoCompraById(id: Int): Resource<PedidoCompra> {
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.getPedidoCompraById(id)
        }.map { it.toDomain() }
    }

    override suspend fun createPedidoCompra(
        fornecedorId: Int, itens: List<ItemCompra>, observacoes: String?,
        condicaoPagamento: String?, prazoEntrega: String?
    ): Resource<PedidoCompra> {
        val request = CreatePedidoCompraRequest(
            fornecedorId = fornecedorId,
            itens = itens.map { CreateItemCompraRequest(it.produtoId, it.descricao, it.quantidade, it.precoUnitario, it.unidade) },
            observacoes = observacoes, condicaoPagamento = condicaoPagamento, prazoEntrega = prazoEntrega
        )
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.createPedidoCompra(request)
        }.map { it.toDomain() }
    }

    override suspend fun updatePedidoCompraStatus(id: Int, status: String, observacao: String?): Resource<PedidoCompra> {
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.updatePedidoCompraStatus(id, UpdateStatusRequest(status, observacao))
        }.map { it.toDomain() }
    }

    override suspend fun getFornecedores(page: Int, perPage: Int, search: String?): Resource<List<Fornecedor>> {
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.getFornecedores(page = page, perPage = perPage, search = search)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getFornecedorById(id: Int): Resource<Fornecedor> {
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.getFornecedorById(id)
        }.map { it.toDomain() }
    }

    override suspend fun createFornecedor(
        nome: String, cnpj: String?, email: String?, telefone: String?,
        endereco: String?, cidade: String?, estado: String?
    ): Resource<Fornecedor> {
        val request = CreateFornecedorRequest(
            nome = nome, cnpj = cnpj, email = email, telefone = telefone,
            endereco = endereco, cidade = cidade, estado = estado
        )
        return NetworkErrorHandler.safeApiCall {
            comprasApiService.createFornecedor(request)
        }.map { it.toDomain() }
    }
}
