package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*

interface ComprasRepository {
    suspend fun getPedidosCompra(page: Int = 1, perPage: Int = 20, search: String? = null, status: String? = null): Resource<List<PedidoCompraResumo>>
    suspend fun getPedidoCompraById(id: Int): Resource<PedidoCompra>
    suspend fun createPedidoCompra(fornecedorId: Int, itens: List<ItemCompra>, observacoes: String?, condicaoPagamento: String?, prazoEntrega: String?): Resource<PedidoCompra>
    suspend fun updatePedidoCompraStatus(id: Int, status: String, observacao: String?): Resource<PedidoCompra>
    suspend fun getFornecedores(page: Int = 1, perPage: Int = 20, search: String? = null): Resource<List<Fornecedor>>
    suspend fun getFornecedorById(id: Int): Resource<Fornecedor>
    suspend fun createFornecedor(nome: String, cnpj: String?, email: String?, telefone: String?, endereco: String?, cidade: String?, estado: String?): Resource<Fornecedor>
}
