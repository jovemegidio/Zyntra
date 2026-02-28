package br.com.aluforce.erp.data.remote.dto

import com.google.gson.annotations.SerializedName

// ============================================================
// AUTH DTOs
// ============================================================

data class LoginRequest(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String,
    @SerializedName("deviceId") val deviceId: String
)

data class LoginResponse(
    @SerializedName("token") val token: String,
    @SerializedName("refreshToken") val refreshToken: String?,
    @SerializedName("user") val user: UserProfileDto,
    @SerializedName("permissions") val permissions: List<String>?
)

data class RefreshTokenRequest(
    @SerializedName("refreshToken") val refreshToken: String,
    @SerializedName("deviceId") val deviceId: String
)

data class RefreshTokenResponse(
    @SerializedName("token") val token: String,
    @SerializedName("refreshToken") val refreshToken: String?
)

data class UserProfileDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("email") val email: String,
    @SerializedName("role") val role: String,
    @SerializedName("is_admin") val isAdmin: Boolean?,
    @SerializedName("avatar") val avatar: String?,
    @SerializedName("departamento") val departamento: String?,
    @SerializedName("cargo") val cargo: String?,
    @SerializedName("telefone") val telefone: String?,
    @SerializedName("status") val status: String?,
    @SerializedName("permissions") val permissions: UserPermissionsDto?
)

data class UserPermissionsDto(
    @SerializedName("modules") val modules: List<String>?,
    @SerializedName("actions") val actions: Map<String, List<String>>?
)

// ============================================================
// DASHBOARD DTOs
// ============================================================

data class DashboardKpisDto(
    @SerializedName("vendas") val vendas: VendasKpiDto?,
    @SerializedName("financeiro") val financeiro: FinanceiroKpiDto?,
    @SerializedName("producao") val producao: ProducaoKpiDto?,
    @SerializedName("compras") val compras: ComprasKpiDto?
)

data class VendasKpiDto(
    @SerializedName("total_pedidos") val totalPedidos: Int,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("pedidos_pendentes") val pedidosPendentes: Int,
    @SerializedName("ticket_medio") val ticketMedio: Double,
    @SerializedName("conversao") val conversao: Double?,
    @SerializedName("crescimento") val crescimento: Double?
)

data class FinanceiroKpiDto(
    @SerializedName("receitas") val receitas: Double,
    @SerializedName("despesas") val despesas: Double,
    @SerializedName("saldo") val saldo: Double,
    @SerializedName("contas_pagar_vencidas") val contasPagarVencidas: Int,
    @SerializedName("contas_receber_vencidas") val contasReceberVencidas: Int
)

data class ProducaoKpiDto(
    @SerializedName("ordens_ativas") val ordensAtivas: Int,
    @SerializedName("ordens_atrasadas") val ordensAtrasadas: Int,
    @SerializedName("eficiencia") val eficiencia: Double?,
    @SerializedName("producao_dia") val producaoDia: Int?
)

data class ComprasKpiDto(
    @SerializedName("pedidos_abertos") val pedidosAbertos: Int,
    @SerializedName("cotacoes_pendentes") val cotacoesPendentes: Int,
    @SerializedName("valor_comprometido") val valorComprometido: Double
)

data class NotificationDto(
    @SerializedName("id") val id: Int,
    @SerializedName("tipo") val tipo: String,
    @SerializedName("titulo") val titulo: String,
    @SerializedName("mensagem") val mensagem: String,
    @SerializedName("lida") val lida: Boolean,
    @SerializedName("modulo") val modulo: String?,
    @SerializedName("referencia_id") val referenciaId: Int?,
    @SerializedName("created_at") val createdAt: String
)

data class PendingApprovalDto(
    @SerializedName("id") val id: Int,
    @SerializedName("tipo") val tipo: String,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("valor") val valor: Double?,
    @SerializedName("solicitante") val solicitante: String,
    @SerializedName("modulo") val modulo: String,
    @SerializedName("created_at") val createdAt: String
)

// ============================================================
// VENDAS DTOs
// ============================================================

data class PedidoListDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("cliente_nome") val clienteNome: String,
    @SerializedName("cliente_id") val clienteId: Int,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("status") val status: String,
    @SerializedName("data_pedido") val dataPedido: String?,
    @SerializedName("prazo_entrega") val prazoEntrega: String?,
    @SerializedName("vendedor") val vendedor: String?,
    @SerializedName("created_at") val createdAt: String
)

data class PedidoDetalheDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("cliente") val cliente: ClienteResumoDto,
    @SerializedName("itens") val itens: List<ItemPedidoDto>,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("valor_desconto") val valorDesconto: Double?,
    @SerializedName("valor_frete") val valorFrete: Double?,
    @SerializedName("status") val status: String,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("condicao_pagamento") val condicaoPagamento: String?,
    @SerializedName("forma_pagamento") val formaPagamento: String?,
    @SerializedName("data_pedido") val dataPedido: String?,
    @SerializedName("prazo_entrega") val prazoEntrega: String?,
    @SerializedName("vendedor") val vendedor: String?,
    @SerializedName("historico") val historico: List<HistoricoPedidoDto>?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String?
)

data class ClienteResumoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("cnpj") val cnpj: String?,
    @SerializedName("email") val email: String?,
    @SerializedName("telefone") val telefone: String?
)

data class ItemPedidoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("produto_id") val produtoId: Int?,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("preco_unitario") val precoUnitario: Double,
    @SerializedName("desconto") val desconto: Double?,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("unidade") val unidade: String?
)

data class HistoricoPedidoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("acao") val acao: String,
    @SerializedName("descricao") val descricao: String?,
    @SerializedName("usuario") val usuario: String?,
    @SerializedName("created_at") val createdAt: String
)

data class ClienteDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("razao_social") val razaoSocial: String?,
    @SerializedName("cnpj") val cnpj: String?,
    @SerializedName("cpf") val cpf: String?,
    @SerializedName("email") val email: String?,
    @SerializedName("telefone") val telefone: String?,
    @SerializedName("celular") val celular: String?,
    @SerializedName("endereco") val endereco: String?,
    @SerializedName("cidade") val cidade: String?,
    @SerializedName("estado") val estado: String?,
    @SerializedName("cep") val cep: String?,
    @SerializedName("contato_principal") val contatoPrincipal: String?,
    @SerializedName("segmento") val segmento: String?,
    @SerializedName("status") val status: String?,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("total_pedidos") val totalPedidos: Int?,
    @SerializedName("valor_total_compras") val valorTotalCompras: Double?,
    @SerializedName("created_at") val createdAt: String?
)

data class CreatePedidoRequest(
    @SerializedName("cliente_id") val clienteId: Int,
    @SerializedName("itens") val itens: List<CreateItemPedidoRequest>,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("condicao_pagamento") val condicaoPagamento: String?,
    @SerializedName("forma_pagamento") val formaPagamento: String?,
    @SerializedName("prazo_entrega") val prazoEntrega: String?
)

data class CreateItemPedidoRequest(
    @SerializedName("produto_id") val produtoId: Int?,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("preco_unitario") val precoUnitario: Double,
    @SerializedName("desconto") val desconto: Double?,
    @SerializedName("unidade") val unidade: String?
)

data class UpdatePedidoStatusRequest(
    @SerializedName("status") val status: String,
    @SerializedName("observacao") val observacao: String?
)
