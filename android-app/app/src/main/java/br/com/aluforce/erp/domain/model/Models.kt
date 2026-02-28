package br.com.aluforce.erp.domain.model

/**
 * Domain models — Pure Kotlin data classes.
 * No framework dependencies. No annotations.
 * These represent the core business entities of ALUFORCE ERP.
 */

// ========== AUTH / USER ==========

data class UserProfile(
    val id: Int,
    val nome: String,
    val email: String,
    val role: String,
    val isAdmin: Boolean,
    val avatar: String?,
    val departamento: String?,
    val cargo: String?,
    val telefone: String?,
    val status: String,
    val permissions: UserPermissions
) {
    val firstName: String get() = nome.split(" ").firstOrNull() ?: nome

    fun hasModuleAccess(module: String): Boolean {
        if (isAdmin) return true
        return permissions.modules.any { it.equals(module, ignoreCase = true) }
    }

    fun hasAction(module: String, action: String): Boolean {
        if (isAdmin) return true
        return permissions.actions[module]?.contains(action) == true
    }
}

data class UserPermissions(
    val modules: List<String>,
    val actions: Map<String, List<String>>
)

data class AuthResult(
    val token: String,
    val refreshToken: String?,
    val user: UserProfile
)

// ========== VENDAS / PEDIDOS ==========

data class PedidoResumo(
    val id: Int,
    val numero: String,
    val clienteNome: String,
    val clienteId: Int,
    val valorTotal: Double,
    val status: PedidoStatus,
    val dataPedido: String?,
    val prazoEntrega: String?,
    val vendedor: String?,
    val createdAt: String
)

data class Pedido(
    val id: Int,
    val numero: String,
    val cliente: ClienteResumo,
    val itens: List<ItemPedido>,
    val valorTotal: Double,
    val valorDesconto: Double,
    val valorFrete: Double,
    val status: PedidoStatus,
    val observacoes: String?,
    val condicaoPagamento: String?,
    val formaPagamento: String?,
    val dataPedido: String?,
    val prazoEntrega: String?,
    val vendedor: String?,
    val historico: List<HistoricoPedido>,
    val createdAt: String,
    val updatedAt: String?
) {
    val valorSubtotal: Double get() = itens.sumOf { it.valorTotal }
    val quantidadeItens: Int get() = itens.size
}

data class ItemPedido(
    val id: Int,
    val produtoId: Int?,
    val descricao: String,
    val quantidade: Double,
    val precoUnitario: Double,
    val desconto: Double,
    val valorTotal: Double,
    val unidade: String
)

data class HistoricoPedido(
    val id: Int,
    val acao: String,
    val descricao: String?,
    val usuario: String?,
    val createdAt: String
)

enum class PedidoStatus(val displayName: String, val color: String) {
    RASCUNHO("Rascunho", "#9E9E9E"),
    PENDENTE("Pendente", "#FF9800"),
    APROVADO("Aprovado", "#4CAF50"),
    EM_PRODUCAO("Em Produção", "#2196F3"),
    FATURADO("Faturado", "#673AB7"),
    ENTREGUE("Entregue", "#00BCD4"),
    CANCELADO("Cancelado", "#F44336"),
    DEVOLVIDO("Devolvido", "#795548"),
    DESCONHECIDO("Desconhecido", "#607D8B");

    companion object {
        fun fromString(value: String): PedidoStatus {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true) ||
                value.replace(" ", "_").equals(it.name, ignoreCase = true)
            } ?: DESCONHECIDO
        }
    }
}

// ========== CLIENTES ==========

data class ClienteResumo(
    val id: Int,
    val nome: String,
    val cnpj: String?,
    val email: String?,
    val telefone: String?
)

data class Cliente(
    val id: Int,
    val nome: String,
    val razaoSocial: String?,
    val cnpj: String?,
    val cpf: String?,
    val email: String?,
    val telefone: String?,
    val celular: String?,
    val endereco: String?,
    val cidade: String?,
    val estado: String?,
    val cep: String?,
    val contatoPrincipal: String?,
    val segmento: String?,
    val status: String,
    val observacoes: String?,
    val totalPedidos: Int,
    val valorTotalCompras: Double,
    val createdAt: String?
) {
    val documento: String? get() = cnpj ?: cpf
    val localidade: String get() = listOfNotNull(cidade, estado).joinToString(" - ").ifBlank { "-" }
}

data class ClienteHistorico(
    val id: Int,
    val acao: String,
    val descricao: String?,
    val usuario: String?,
    val createdAt: String
)

// ========== DASHBOARD ==========

data class DashboardKpis(
    val vendas: VendasKpi?,
    val financeiro: FinanceiroKpi?,
    val producao: ProducaoKpi?,
    val compras: ComprasKpi?
)

data class VendasKpi(
    val totalPedidos: Int,
    val valorTotal: Double,
    val pedidosPendentes: Int,
    val ticketMedio: Double,
    val conversao: Double?,
    val crescimento: Double?
)

data class FinanceiroKpi(
    val receitas: Double,
    val despesas: Double,
    val saldo: Double,
    val contasPagarVencidas: Int,
    val contasReceberVencidas: Int
)

data class ProducaoKpi(
    val ordensAtivas: Int,
    val ordensAtrasadas: Int,
    val eficiencia: Double?,
    val producaoDia: Int?
)

data class ComprasKpi(
    val pedidosAbertos: Int,
    val cotacoesPendentes: Int,
    val valorComprometido: Double
)

data class Notification(
    val id: Int,
    val tipo: String,
    val titulo: String,
    val mensagem: String,
    val lida: Boolean,
    val modulo: String?,
    val referenciaId: Int?,
    val createdAt: String
)

// ========== COMPRAS ==========

data class PedidoCompraResumo(
    val id: Int,
    val numero: String,
    val fornecedorNome: String,
    val fornecedorId: Int,
    val valorTotal: Double,
    val status: CompraStatus,
    val dataPedido: String?,
    val prazoEntrega: String?,
    val comprador: String?,
    val createdAt: String
)

data class PedidoCompra(
    val id: Int,
    val numero: String,
    val fornecedor: FornecedorResumo,
    val itens: List<ItemCompra>,
    val valorTotal: Double,
    val valorDesconto: Double,
    val valorFrete: Double,
    val status: CompraStatus,
    val observacoes: String?,
    val condicaoPagamento: String?,
    val formaPagamento: String?,
    val dataPedido: String?,
    val prazoEntrega: String?,
    val comprador: String?,
    val createdAt: String,
    val updatedAt: String?
)

data class ItemCompra(
    val id: Int,
    val produtoId: Int?,
    val descricao: String,
    val quantidade: Double,
    val precoUnitario: Double,
    val desconto: Double,
    val valorTotal: Double,
    val unidade: String
)

enum class CompraStatus(val displayName: String, val color: String) {
    RASCUNHO("Rascunho", "#9E9E9E"),
    PENDENTE("Pendente", "#FF9800"),
    APROVADO("Aprovado", "#4CAF50"),
    ENVIADO("Enviado", "#2196F3"),
    RECEBIDO_PARCIAL("Parcial", "#673AB7"),
    RECEBIDO("Recebido", "#00BCD4"),
    CANCELADO("Cancelado", "#F44336"),
    DESCONHECIDO("Desconhecido", "#607D8B");

    companion object {
        fun fromString(value: String): CompraStatus {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true) ||
                value.replace(" ", "_").equals(it.name, ignoreCase = true)
            } ?: DESCONHECIDO
        }
    }
}

// ========== FORNECEDORES ==========

data class FornecedorResumo(
    val id: Int,
    val nome: String,
    val cnpj: String?,
    val email: String?,
    val telefone: String?
)

data class Fornecedor(
    val id: Int,
    val nome: String,
    val razaoSocial: String?,
    val cnpj: String?,
    val cpf: String?,
    val email: String?,
    val telefone: String?,
    val celular: String?,
    val endereco: String?,
    val cidade: String?,
    val estado: String?,
    val cep: String?,
    val contatoPrincipal: String?,
    val segmento: String?,
    val status: String,
    val observacoes: String?,
    val totalPedidos: Int,
    val valorTotalCompras: Double,
    val avaliacao: Double?,
    val createdAt: String?
) {
    val documento: String? get() = cnpj ?: cpf
    val localidade: String get() = listOfNotNull(cidade, estado).joinToString(" - ").ifBlank { "-" }
}

// ========== PCP (Producao) ==========

data class OrdemProducaoResumo(
    val id: Int,
    val numero: String,
    val produto: String,
    val quantidade: Double,
    val quantidadeProduzida: Double,
    val status: OrdemStatus,
    val prioridade: String?,
    val dataInicio: String?,
    val dataPrevisao: String?,
    val responsavel: String?,
    val createdAt: String
) {
    val progresso: Double get() = if (quantidade > 0) (quantidadeProduzida / quantidade) * 100 else 0.0
}

data class OrdemProducao(
    val id: Int,
    val numero: String,
    val produto: String,
    val produtoId: Int?,
    val quantidade: Double,
    val quantidadeProduzida: Double,
    val unidade: String,
    val status: OrdemStatus,
    val prioridade: String?,
    val observacoes: String?,
    val dataInicio: String?,
    val dataPrevisao: String?,
    val dataConclusao: String?,
    val responsavel: String?,
    val etapas: List<EtapaProducao>,
    val apontamentos: List<Apontamento>,
    val materiaisConsumidos: List<MaterialConsumido>,
    val createdAt: String,
    val updatedAt: String?
) {
    val progresso: Double get() = if (quantidade > 0) (quantidadeProduzida / quantidade) * 100 else 0.0
}

data class EtapaProducao(
    val id: Int,
    val nome: String,
    val ordem: Int,
    val status: String,
    val tempoEstimado: Int?,
    val tempoReal: Int?,
    val responsavel: String?
)

data class Apontamento(
    val id: Int,
    val ordemId: Int,
    val tipo: String,
    val quantidade: Double,
    val observacao: String?,
    val operador: String?,
    val dataHora: String,
    val createdAt: String
)

data class MaterialConsumido(
    val id: Int,
    val produtoId: Int?,
    val descricao: String,
    val quantidade: Double,
    val unidade: String
)

enum class OrdemStatus(val displayName: String, val color: String) {
    PLANEJADA("Planejada", "#9E9E9E"),
    AGUARDANDO_MATERIAL("Aguardando Material", "#FF9800"),
    EM_PRODUCAO("Em Produção", "#2196F3"),
    PAUSADA("Pausada", "#FFC107"),
    CONCLUIDA("Concluída", "#4CAF50"),
    CANCELADA("Cancelada", "#F44336"),
    DESCONHECIDO("Desconhecido", "#607D8B");

    companion object {
        fun fromString(value: String): OrdemStatus {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true) ||
                value.replace(" ", "_").equals(it.name, ignoreCase = true)
            } ?: DESCONHECIDO
        }
    }
}

// ========== FINANCEIRO ==========

data class ContaPagar(
    val id: Int,
    val descricao: String,
    val fornecedor: String?,
    val fornecedorId: Int?,
    val valor: Double,
    val valorPago: Double,
    val dataVencimento: String,
    val dataPagamento: String?,
    val status: ContaStatus,
    val categoria: String?,
    val centroCusto: String?,
    val formaPagamento: String?,
    val observacoes: String?,
    val parcela: String?,
    val createdAt: String
) {
    val valorRestante: Double get() = valor - valorPago
    val isVencida: Boolean get() = status == ContaStatus.VENCIDA
}

data class ContaReceber(
    val id: Int,
    val descricao: String,
    val cliente: String?,
    val clienteId: Int?,
    val valor: Double,
    val valorRecebido: Double,
    val dataVencimento: String,
    val dataRecebimento: String?,
    val status: ContaStatus,
    val categoria: String?,
    val centroCusto: String?,
    val formaPagamento: String?,
    val observacoes: String?,
    val parcela: String?,
    val pedidoId: Int?,
    val createdAt: String
) {
    val valorRestante: Double get() = valor - valorRecebido
    val isVencida: Boolean get() = status == ContaStatus.VENCIDA
}

enum class ContaStatus(val displayName: String, val color: String) {
    ABERTA("Aberta", "#2196F3"),
    PAGA("Paga", "#4CAF50"),
    RECEBIDA("Recebida", "#4CAF50"),
    VENCIDA("Vencida", "#F44336"),
    PARCIAL("Parcial", "#FF9800"),
    CANCELADA("Cancelada", "#9E9E9E"),
    DESCONHECIDO("Desconhecido", "#607D8B");

    companion object {
        fun fromString(value: String): ContaStatus {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true)
            } ?: DESCONHECIDO
        }
    }
}

data class FluxoCaixa(
    val periodo: String,
    val saldoInicial: Double,
    val totalEntradas: Double,
    val totalSaidas: Double,
    val saldoFinal: Double,
    val movimentacoes: List<MovimentacaoFinanceira>
)

data class MovimentacaoFinanceira(
    val id: Int,
    val tipo: String,
    val descricao: String,
    val valor: Double,
    val data: String,
    val categoria: String?,
    val conta: String?
)

data class ResumoFinanceiro(
    val totalReceitas: Double,
    val totalDespesas: Double,
    val saldo: Double,
    val contasPagarVencidas: Int,
    val contasPagarHoje: Int,
    val contasReceberVencidas: Int,
    val contasReceberHoje: Int,
    val fluxoMensal: List<FluxoMensal>
)

data class FluxoMensal(
    val mes: String,
    val entradas: Double,
    val saidas: Double,
    val saldo: Double
)

// ========== RH ==========

data class Funcionario(
    val id: Int,
    val nome: String,
    val cpf: String?,
    val email: String?,
    val telefone: String?,
    val cargo: String?,
    val departamento: String?,
    val dataAdmissao: String?,
    val dataDemissao: String?,
    val salario: Double?,
    val status: String,
    val avatar: String?,
    val endereco: String?,
    val cidade: String?,
    val estado: String?,
    val createdAt: String?
) {
    val isAtivo: Boolean get() = status.equals("ativo", ignoreCase = true)
}

data class RegistroPonto(
    val id: Int,
    val funcionarioId: Int,
    val funcionarioNome: String?,
    val data: String,
    val entrada: String?,
    val saidaAlmoco: String?,
    val retornoAlmoco: String?,
    val saida: String?,
    val horasTrabalhadas: Double?,
    val horasExtras: Double?,
    val observacao: String?,
    val status: String
)

data class Holerite(
    val id: Int,
    val funcionarioId: Int,
    val competencia: String,
    val salarioBruto: Double,
    val descontos: Double,
    val salarioLiquido: Double,
    val status: String,
    val detalhes: List<ItemHolerite>
)

data class ItemHolerite(
    val descricao: String,
    val tipo: String,
    val valor: Double
)

// ========== NFe ==========

data class NotaFiscal(
    val id: Int,
    val numero: String?,
    val serie: String?,
    val chaveAcesso: String?,
    val tipo: String,
    val naturezaOperacao: String?,
    val destinatario: String?,
    val destinatarioCnpj: String?,
    val valorTotal: Double,
    val status: NFeStatus,
    val dataEmissao: String?,
    val dataAutorizacao: String?,
    val protocolo: String?,
    val pedidoId: Int?,
    val observacoes: String?,
    val createdAt: String
)

enum class NFeStatus(val displayName: String, val color: String) {
    RASCUNHO("Rascunho", "#9E9E9E"),
    VALIDADA("Validada", "#2196F3"),
    AUTORIZADA("Autorizada", "#4CAF50"),
    CANCELADA("Cancelada", "#F44336"),
    DENEGADA("Denegada", "#795548"),
    INUTILIZADA("Inutilizada", "#607D8B"),
    REJEITADA("Rejeitada", "#FF5722"),
    DESCONHECIDO("Desconhecido", "#607D8B");

    companion object {
        fun fromString(value: String): NFeStatus {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true)
            } ?: DESCONHECIDO
        }
    }
}

// ========== CONFIGURACOES / PERFIL ==========

data class AppConfig(
    val notificacoesAtivas: Boolean,
    val temaEscuro: Boolean,
    val biometriaAtiva: Boolean,
    val timeoutSessao: Int,
    val sincronizacaoAutomatica: Boolean,
    val qualidadeImagem: String,
    val idioma: String
)
