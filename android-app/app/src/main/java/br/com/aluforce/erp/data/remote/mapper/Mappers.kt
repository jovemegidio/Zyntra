package br.com.aluforce.erp.data.remote.mapper

import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.domain.model.*

/**
 * Mappers from DTO (API response) to Domain Model.
 *
 * Design principle: DTOs are coupled to API contract; Domain models are clean entities.
 * Mapping ensures domain layer stays independent of API changes.
 */
object AuthMapper {

    fun UserProfileDto.toDomain(): UserProfile = UserProfile(
        id = id,
        nome = nome,
        email = email,
        role = role,
        isAdmin = isAdmin ?: false,
        avatar = avatar,
        departamento = departamento,
        cargo = cargo,
        telefone = telefone,
        status = status ?: "ativo",
        permissions = permissions?.toDomain() ?: UserPermissions(emptyList(), emptyMap())
    )

    private fun UserPermissionsDto.toDomain(): UserPermissions = UserPermissions(
        modules = modules ?: emptyList(),
        actions = actions ?: emptyMap()
    )
}

object VendasMapper {

    fun PedidoListDto.toDomain(): PedidoResumo = PedidoResumo(
        id = id,
        numero = numero ?: "#$id",
        clienteNome = clienteNome,
        clienteId = clienteId,
        valorTotal = valorTotal,
        status = PedidoStatus.fromString(status),
        dataPedido = dataPedido,
        prazoEntrega = prazoEntrega,
        vendedor = vendedor,
        createdAt = createdAt
    )

    fun PedidoDetalheDto.toDomain(): Pedido = Pedido(
        id = id,
        numero = numero ?: "#$id",
        cliente = cliente.toDomain(),
        itens = itens.map { it.toDomain() },
        valorTotal = valorTotal,
        valorDesconto = valorDesconto ?: 0.0,
        valorFrete = valorFrete ?: 0.0,
        status = PedidoStatus.fromString(status),
        observacoes = observacoes,
        condicaoPagamento = condicaoPagamento,
        formaPagamento = formaPagamento,
        dataPedido = dataPedido,
        prazoEntrega = prazoEntrega,
        vendedor = vendedor,
        historico = historico?.map { it.toDomain() } ?: emptyList(),
        createdAt = createdAt,
        updatedAt = updatedAt
    )

    private fun ClienteResumoDto.toDomain(): ClienteResumo = ClienteResumo(
        id = id,
        nome = nome,
        cnpj = cnpj,
        email = email,
        telefone = telefone
    )

    private fun ItemPedidoDto.toDomain(): ItemPedido = ItemPedido(
        id = id,
        produtoId = produtoId,
        descricao = descricao,
        quantidade = quantidade,
        precoUnitario = precoUnitario,
        desconto = desconto ?: 0.0,
        valorTotal = valorTotal,
        unidade = unidade ?: "UN"
    )

    private fun HistoricoPedidoDto.toDomain(): HistoricoPedido = HistoricoPedido(
        id = id,
        acao = acao,
        descricao = descricao,
        usuario = usuario,
        createdAt = createdAt
    )

    fun ClienteDto.toDomain(): Cliente = Cliente(
        id = id,
        nome = nome,
        razaoSocial = razaoSocial,
        cnpj = cnpj,
        cpf = cpf,
        email = email,
        telefone = telefone,
        celular = celular,
        endereco = endereco,
        cidade = cidade,
        estado = estado,
        cep = cep,
        contatoPrincipal = contatoPrincipal,
        segmento = segmento,
        status = status ?: "ativo",
        observacoes = observacoes,
        totalPedidos = totalPedidos ?: 0,
        valorTotalCompras = valorTotalCompras ?: 0.0,
        createdAt = createdAt
    )
}

object DashboardMapper {

    fun DashboardKpisDto.toDomain(): DashboardKpis = DashboardKpis(
        vendas = vendas?.let {
            VendasKpi(
                totalPedidos = it.totalPedidos,
                valorTotal = it.valorTotal,
                pedidosPendentes = it.pedidosPendentes,
                ticketMedio = it.ticketMedio,
                conversao = it.conversao,
                crescimento = it.crescimento
            )
        },
        financeiro = financeiro?.let {
            FinanceiroKpi(
                receitas = it.receitas,
                despesas = it.despesas,
                saldo = it.saldo,
                contasPagarVencidas = it.contasPagarVencidas,
                contasReceberVencidas = it.contasReceberVencidas
            )
        },
        producao = producao?.let {
            ProducaoKpi(
                ordensAtivas = it.ordensAtivas,
                ordensAtrasadas = it.ordensAtrasadas,
                eficiencia = it.eficiencia,
                producaoDia = it.producaoDia
            )
        },
        compras = compras?.let {
            ComprasKpi(
                pedidosAbertos = it.pedidosAbertos,
                cotacoesPendentes = it.cotacoesPendentes,
                valorComprometido = it.valorComprometido
            )
        }
    )

    fun NotificationDto.toDomain(): Notification = Notification(
        id = id,
        tipo = tipo,
        titulo = titulo,
        mensagem = mensagem,
        lida = lida,
        modulo = modulo,
        referenciaId = referenciaId,
        createdAt = createdAt
    )
}
