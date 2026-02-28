package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.VendasApiService
import br.com.aluforce.erp.data.remote.dto.CreateItemPedidoRequest
import br.com.aluforce.erp.data.remote.dto.CreatePedidoRequest
import br.com.aluforce.erp.data.remote.dto.UpdatePedidoStatusRequest
import br.com.aluforce.erp.data.remote.mapper.VendasMapper.toDomain
import br.com.aluforce.erp.domain.model.Cliente
import br.com.aluforce.erp.domain.model.Pedido
import br.com.aluforce.erp.domain.model.PedidoResumo
import br.com.aluforce.erp.domain.repository.VendasRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VendasRepositoryImpl @Inject constructor(
    private val vendasApiService: VendasApiService
) : VendasRepository {

    override suspend fun getPedidos(
        page: Int,
        perPage: Int,
        search: String?,
        status: String?,
        sort: String,
        order: String
    ): Resource<List<PedidoResumo>> {
        return NetworkErrorHandler.safeApiCall {
            vendasApiService.getPedidos(
                page = page,
                perPage = perPage,
                search = search,
                status = status,
                sort = sort,
                order = order
            )
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getPedidoById(id: Int): Resource<Pedido> {
        return NetworkErrorHandler.safeApiCall {
            vendasApiService.getPedidoById(id)
        }.map { it.toDomain() }
    }

    override suspend fun createPedido(pedido: Pedido): Resource<Pedido> {
        val request = CreatePedidoRequest(
            clienteId = pedido.cliente.id,
            itens = pedido.itens.map { item ->
                CreateItemPedidoRequest(
                    produtoId = item.produtoId,
                    descricao = item.descricao,
                    quantidade = item.quantidade,
                    precoUnitario = item.precoUnitario,
                    desconto = item.desconto.takeIf { it > 0 },
                    unidade = item.unidade
                )
            },
            observacoes = pedido.observacoes,
            condicaoPagamento = pedido.condicaoPagamento,
            formaPagamento = pedido.formaPagamento,
            prazoEntrega = pedido.prazoEntrega
        )
        return NetworkErrorHandler.safeApiCall {
            vendasApiService.createPedido(request)
        }.map { it.toDomain() }
    }

    override suspend fun updatePedidoStatus(
        id: Int,
        status: String,
        observacao: String?
    ): Resource<Pedido> {
        return NetworkErrorHandler.safeApiCall {
            vendasApiService.updatePedidoStatus(
                id = id,
                request = UpdatePedidoStatusRequest(status = status, observacao = observacao)
            )
        }.map { it.toDomain() }
    }

    override suspend fun getClientes(
        page: Int,
        perPage: Int,
        search: String?
    ): Resource<List<Cliente>> {
        return NetworkErrorHandler.safeApiCall {
            vendasApiService.getClientes(page = page, perPage = perPage, search = search)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getClienteById(id: Int): Resource<Cliente> {
        return NetworkErrorHandler.safeApiCall {
            vendasApiService.getClienteById(id)
        }.map { it.toDomain() }
    }
}
