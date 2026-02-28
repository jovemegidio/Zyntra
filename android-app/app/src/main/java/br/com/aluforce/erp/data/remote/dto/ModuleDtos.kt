package br.com.aluforce.erp.data.remote.dto

import com.google.gson.annotations.SerializedName

// ============================================================
// CLIENTES DTOs (extended)
// ============================================================

data class CreateClienteRequest(
    @SerializedName("nome") val nome: String,
    @SerializedName("razao_social") val razaoSocial: String? = null,
    @SerializedName("cnpj") val cnpj: String? = null,
    @SerializedName("cpf") val cpf: String? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("telefone") val telefone: String? = null,
    @SerializedName("celular") val celular: String? = null,
    @SerializedName("endereco") val endereco: String? = null,
    @SerializedName("cidade") val cidade: String? = null,
    @SerializedName("estado") val estado: String? = null,
    @SerializedName("cep") val cep: String? = null,
    @SerializedName("segmento") val segmento: String? = null,
    @SerializedName("observacoes") val observacoes: String? = null
)

data class UpdateClienteRequest(
    @SerializedName("nome") val nome: String? = null,
    @SerializedName("razao_social") val razaoSocial: String? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("telefone") val telefone: String? = null,
    @SerializedName("celular") val celular: String? = null,
    @SerializedName("endereco") val endereco: String? = null,
    @SerializedName("cidade") val cidade: String? = null,
    @SerializedName("estado") val estado: String? = null,
    @SerializedName("cep") val cep: String? = null,
    @SerializedName("segmento") val segmento: String? = null,
    @SerializedName("observacoes") val observacoes: String? = null,
    @SerializedName("status") val status: String? = null
)

data class HistoricoClienteDto(
    @SerializedName("id") val id: Int,
    @SerializedName("acao") val acao: String,
    @SerializedName("descricao") val descricao: String?,
    @SerializedName("usuario") val usuario: String?,
    @SerializedName("created_at") val createdAt: String
)

// ============================================================
// COMPRAS DTOs
// ============================================================

data class PedidoCompraListDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("fornecedor_nome") val fornecedorNome: String,
    @SerializedName("fornecedor_id") val fornecedorId: Int,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("status") val status: String,
    @SerializedName("data_pedido") val dataPedido: String?,
    @SerializedName("prazo_entrega") val prazoEntrega: String?,
    @SerializedName("comprador") val comprador: String?,
    @SerializedName("created_at") val createdAt: String
)

data class PedidoCompraDetalheDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("fornecedor") val fornecedor: FornecedorResumoDto,
    @SerializedName("itens") val itens: List<ItemCompraDto>,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("valor_desconto") val valorDesconto: Double?,
    @SerializedName("valor_frete") val valorFrete: Double?,
    @SerializedName("status") val status: String,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("condicao_pagamento") val condicaoPagamento: String?,
    @SerializedName("forma_pagamento") val formaPagamento: String?,
    @SerializedName("data_pedido") val dataPedido: String?,
    @SerializedName("prazo_entrega") val prazoEntrega: String?,
    @SerializedName("comprador") val comprador: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String?
)

data class FornecedorResumoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("cnpj") val cnpj: String?,
    @SerializedName("email") val email: String?,
    @SerializedName("telefone") val telefone: String?
)

data class ItemCompraDto(
    @SerializedName("id") val id: Int,
    @SerializedName("produto_id") val produtoId: Int?,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("preco_unitario") val precoUnitario: Double,
    @SerializedName("desconto") val desconto: Double?,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("unidade") val unidade: String?
)

data class FornecedorDto(
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
    @SerializedName("avaliacao") val avaliacao: Double?,
    @SerializedName("created_at") val createdAt: String?
)

data class CreatePedidoCompraRequest(
    @SerializedName("fornecedor_id") val fornecedorId: Int,
    @SerializedName("itens") val itens: List<CreateItemCompraRequest>,
    @SerializedName("observacoes") val observacoes: String? = null,
    @SerializedName("condicao_pagamento") val condicaoPagamento: String? = null,
    @SerializedName("forma_pagamento") val formaPagamento: String? = null,
    @SerializedName("prazo_entrega") val prazoEntrega: String? = null
)

data class CreateItemCompraRequest(
    @SerializedName("produto_id") val produtoId: Int? = null,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("preco_unitario") val precoUnitario: Double,
    @SerializedName("unidade") val unidade: String? = null
)

data class CreateFornecedorRequest(
    @SerializedName("nome") val nome: String,
    @SerializedName("razao_social") val razaoSocial: String? = null,
    @SerializedName("cnpj") val cnpj: String? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("telefone") val telefone: String? = null,
    @SerializedName("endereco") val endereco: String? = null,
    @SerializedName("cidade") val cidade: String? = null,
    @SerializedName("estado") val estado: String? = null,
    @SerializedName("cep") val cep: String? = null,
    @SerializedName("segmento") val segmento: String? = null
)

data class UpdateFornecedorRequest(
    @SerializedName("nome") val nome: String? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("telefone") val telefone: String? = null,
    @SerializedName("endereco") val endereco: String? = null,
    @SerializedName("cidade") val cidade: String? = null,
    @SerializedName("estado") val estado: String? = null,
    @SerializedName("status") val status: String? = null
)

data class CotacaoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("status") val status: String,
    @SerializedName("data_limite") val dataLimite: String?,
    @SerializedName("total_fornecedores") val totalFornecedores: Int,
    @SerializedName("created_at") val createdAt: String
)

data class UpdateStatusRequest(
    @SerializedName("status") val status: String,
    @SerializedName("observacao") val observacao: String? = null
)

// ============================================================
// PCP DTOs
// ============================================================

data class OrdemProducaoListDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("produto") val produto: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("quantidade_produzida") val quantidadeProduzida: Double?,
    @SerializedName("status") val status: String,
    @SerializedName("prioridade") val prioridade: String?,
    @SerializedName("data_inicio") val dataInicio: String?,
    @SerializedName("data_previsao") val dataPrevisao: String?,
    @SerializedName("responsavel") val responsavel: String?,
    @SerializedName("created_at") val createdAt: String
)

data class OrdemProducaoDetalheDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("produto") val produto: String,
    @SerializedName("produto_id") val produtoId: Int?,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("quantidade_produzida") val quantidadeProduzida: Double?,
    @SerializedName("unidade") val unidade: String?,
    @SerializedName("status") val status: String,
    @SerializedName("prioridade") val prioridade: String?,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("data_inicio") val dataInicio: String?,
    @SerializedName("data_previsao") val dataPrevisao: String?,
    @SerializedName("data_conclusao") val dataConclusao: String?,
    @SerializedName("responsavel") val responsavel: String?,
    @SerializedName("etapas") val etapas: List<EtapaProducaoDto>?,
    @SerializedName("apontamentos") val apontamentos: List<ApontamentoDto>?,
    @SerializedName("materiais") val materiais: List<MaterialConsumidoDto>?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String?
)

data class EtapaProducaoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("ordem") val ordem: Int,
    @SerializedName("status") val status: String?,
    @SerializedName("tempo_estimado") val tempoEstimado: Int?,
    @SerializedName("tempo_real") val tempoReal: Int?,
    @SerializedName("responsavel") val responsavel: String?
)

data class ApontamentoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("ordem_id") val ordemId: Int,
    @SerializedName("tipo") val tipo: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("observacao") val observacao: String?,
    @SerializedName("operador") val operador: String?,
    @SerializedName("data_hora") val dataHora: String,
    @SerializedName("created_at") val createdAt: String
)

data class MaterialConsumidoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("produto_id") val produtoId: Int?,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("unidade") val unidade: String?
)

data class CreateOrdemRequest(
    @SerializedName("produto") val produto: String,
    @SerializedName("produto_id") val produtoId: Int? = null,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("unidade") val unidade: String = "UN",
    @SerializedName("prioridade") val prioridade: String = "normal",
    @SerializedName("data_previsao") val dataPrevisao: String? = null,
    @SerializedName("observacoes") val observacoes: String? = null
)

data class CreateApontamentoRequest(
    @SerializedName("ordem_id") val ordemId: Int,
    @SerializedName("tipo") val tipo: String,
    @SerializedName("quantidade") val quantidade: Double,
    @SerializedName("observacao") val observacao: String? = null
)

data class KanbanColumnDto(
    @SerializedName("status") val status: String,
    @SerializedName("nome") val nome: String,
    @SerializedName("ordens") val ordens: List<OrdemProducaoListDto>,
    @SerializedName("total") val total: Int
)

data class DashboardPCPDto(
    @SerializedName("ordens_ativas") val ordensAtivas: Int,
    @SerializedName("ordens_atrasadas") val ordensAtrasadas: Int,
    @SerializedName("producao_hoje") val producaoHoje: Int,
    @SerializedName("eficiencia") val eficiencia: Double?,
    @SerializedName("por_status") val porStatus: Map<String, Int>?
)

// ============================================================
// FINANCEIRO DTOs
// ============================================================

data class ContaPagarDto(
    @SerializedName("id") val id: Int,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("fornecedor") val fornecedor: String?,
    @SerializedName("fornecedor_id") val fornecedorId: Int?,
    @SerializedName("valor") val valor: Double,
    @SerializedName("valor_pago") val valorPago: Double?,
    @SerializedName("data_vencimento") val dataVencimento: String,
    @SerializedName("data_pagamento") val dataPagamento: String?,
    @SerializedName("status") val status: String,
    @SerializedName("categoria") val categoria: String?,
    @SerializedName("centro_custo") val centroCusto: String?,
    @SerializedName("forma_pagamento") val formaPagamento: String?,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("parcela") val parcela: String?,
    @SerializedName("created_at") val createdAt: String
)

data class ContaReceberDto(
    @SerializedName("id") val id: Int,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("cliente") val cliente: String?,
    @SerializedName("cliente_id") val clienteId: Int?,
    @SerializedName("valor") val valor: Double,
    @SerializedName("valor_recebido") val valorRecebido: Double?,
    @SerializedName("data_vencimento") val dataVencimento: String,
    @SerializedName("data_recebimento") val dataRecebimento: String?,
    @SerializedName("status") val status: String,
    @SerializedName("categoria") val categoria: String?,
    @SerializedName("centro_custo") val centroCusto: String?,
    @SerializedName("forma_pagamento") val formaPagamento: String?,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("parcela") val parcela: String?,
    @SerializedName("pedido_id") val pedidoId: Int?,
    @SerializedName("created_at") val createdAt: String
)

data class CreateContaPagarRequest(
    @SerializedName("descricao") val descricao: String,
    @SerializedName("fornecedor_id") val fornecedorId: Int? = null,
    @SerializedName("valor") val valor: Double,
    @SerializedName("data_vencimento") val dataVencimento: String,
    @SerializedName("categoria") val categoria: String? = null,
    @SerializedName("centro_custo") val centroCusto: String? = null,
    @SerializedName("forma_pagamento") val formaPagamento: String? = null,
    @SerializedName("observacoes") val observacoes: String? = null
)

data class CreateContaReceberRequest(
    @SerializedName("descricao") val descricao: String,
    @SerializedName("cliente_id") val clienteId: Int? = null,
    @SerializedName("valor") val valor: Double,
    @SerializedName("data_vencimento") val dataVencimento: String,
    @SerializedName("categoria") val categoria: String? = null,
    @SerializedName("centro_custo") val centroCusto: String? = null,
    @SerializedName("forma_pagamento") val formaPagamento: String? = null,
    @SerializedName("observacoes") val observacoes: String? = null
)

data class PagarContaRequest(
    @SerializedName("valor_pago") val valorPago: Double,
    @SerializedName("data_pagamento") val dataPagamento: String,
    @SerializedName("forma_pagamento") val formaPagamento: String? = null,
    @SerializedName("observacao") val observacao: String? = null
)

data class ReceberContaRequest(
    @SerializedName("valor_recebido") val valorRecebido: Double,
    @SerializedName("data_recebimento") val dataRecebimento: String,
    @SerializedName("forma_pagamento") val formaPagamento: String? = null,
    @SerializedName("observacao") val observacao: String? = null
)

data class FluxoCaixaDto(
    @SerializedName("periodo") val periodo: String,
    @SerializedName("saldo_inicial") val saldoInicial: Double,
    @SerializedName("total_entradas") val totalEntradas: Double,
    @SerializedName("total_saidas") val totalSaidas: Double,
    @SerializedName("saldo_final") val saldoFinal: Double,
    @SerializedName("movimentacoes") val movimentacoes: List<MovimentacaoDto>?
)

data class MovimentacaoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("tipo") val tipo: String,
    @SerializedName("descricao") val descricao: String,
    @SerializedName("valor") val valor: Double,
    @SerializedName("data") val data: String,
    @SerializedName("categoria") val categoria: String?,
    @SerializedName("conta") val conta: String?
)

data class ResumoFinanceiroDto(
    @SerializedName("total_receitas") val totalReceitas: Double,
    @SerializedName("total_despesas") val totalDespesas: Double,
    @SerializedName("saldo") val saldo: Double,
    @SerializedName("contas_pagar_vencidas") val contasPagarVencidas: Int,
    @SerializedName("contas_pagar_hoje") val contasPagarHoje: Int,
    @SerializedName("contas_receber_vencidas") val contasReceberVencidas: Int,
    @SerializedName("contas_receber_hoje") val contasReceberHoje: Int,
    @SerializedName("fluxo_mensal") val fluxoMensal: List<FluxoMensalDto>?
)

data class FluxoMensalDto(
    @SerializedName("mes") val mes: String,
    @SerializedName("entradas") val entradas: Double,
    @SerializedName("saidas") val saidas: Double,
    @SerializedName("saldo") val saldo: Double
)

// ============================================================
// RH DTOs
// ============================================================

data class FuncionarioDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("cpf") val cpf: String?,
    @SerializedName("email") val email: String?,
    @SerializedName("telefone") val telefone: String?,
    @SerializedName("cargo") val cargo: String?,
    @SerializedName("departamento") val departamento: String?,
    @SerializedName("data_admissao") val dataAdmissao: String?,
    @SerializedName("data_demissao") val dataDemissao: String?,
    @SerializedName("salario") val salario: Double?,
    @SerializedName("status") val status: String?,
    @SerializedName("avatar") val avatar: String?,
    @SerializedName("endereco") val endereco: String?,
    @SerializedName("cidade") val cidade: String?,
    @SerializedName("estado") val estado: String?,
    @SerializedName("created_at") val createdAt: String?
)

data class CreateFuncionarioRequest(
    @SerializedName("nome") val nome: String,
    @SerializedName("cpf") val cpf: String? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("telefone") val telefone: String? = null,
    @SerializedName("cargo") val cargo: String? = null,
    @SerializedName("departamento") val departamento: String? = null,
    @SerializedName("data_admissao") val dataAdmissao: String? = null,
    @SerializedName("salario") val salario: Double? = null
)

data class UpdateFuncionarioRequest(
    @SerializedName("nome") val nome: String? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("telefone") val telefone: String? = null,
    @SerializedName("cargo") val cargo: String? = null,
    @SerializedName("departamento") val departamento: String? = null,
    @SerializedName("salario") val salario: Double? = null,
    @SerializedName("status") val status: String? = null
)

data class RegistroPontoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("funcionario_id") val funcionarioId: Int,
    @SerializedName("funcionario_nome") val funcionarioNome: String?,
    @SerializedName("data") val data: String,
    @SerializedName("entrada") val entrada: String?,
    @SerializedName("saida_almoco") val saidaAlmoco: String?,
    @SerializedName("retorno_almoco") val retornoAlmoco: String?,
    @SerializedName("saida") val saida: String?,
    @SerializedName("horas_trabalhadas") val horasTrabalhadas: Double?,
    @SerializedName("horas_extras") val horasExtras: Double?,
    @SerializedName("observacao") val observacao: String?,
    @SerializedName("status") val status: String?
)

data class RegistrarPontoRequest(
    @SerializedName("tipo") val tipo: String // "entrada", "saida_almoco", "retorno_almoco", "saida"
)

data class HoleriteDto(
    @SerializedName("id") val id: Int,
    @SerializedName("funcionario_id") val funcionarioId: Int,
    @SerializedName("competencia") val competencia: String,
    @SerializedName("salario_bruto") val salarioBruto: Double,
    @SerializedName("descontos") val descontos: Double,
    @SerializedName("salario_liquido") val salarioLiquido: Double,
    @SerializedName("status") val status: String?,
    @SerializedName("detalhes") val detalhes: List<ItemHoleriteDto>?
)

data class ItemHoleriteDto(
    @SerializedName("descricao") val descricao: String,
    @SerializedName("tipo") val tipo: String,
    @SerializedName("valor") val valor: Double
)

data class DepartamentoDto(
    @SerializedName("id") val id: Int,
    @SerializedName("nome") val nome: String,
    @SerializedName("total_funcionarios") val totalFuncionarios: Int?
)

// ============================================================
// NFe DTOs
// ============================================================

data class NotaFiscalDto(
    @SerializedName("id") val id: Int,
    @SerializedName("numero") val numero: String?,
    @SerializedName("serie") val serie: String?,
    @SerializedName("chave_acesso") val chaveAcesso: String?,
    @SerializedName("tipo") val tipo: String?,
    @SerializedName("natureza_operacao") val naturezaOperacao: String?,
    @SerializedName("destinatario") val destinatario: String?,
    @SerializedName("destinatario_cnpj") val destinatarioCnpj: String?,
    @SerializedName("valor_total") val valorTotal: Double,
    @SerializedName("status") val status: String,
    @SerializedName("data_emissao") val dataEmissao: String?,
    @SerializedName("data_autorizacao") val dataAutorizacao: String?,
    @SerializedName("protocolo") val protocolo: String?,
    @SerializedName("pedido_id") val pedidoId: Int?,
    @SerializedName("observacoes") val observacoes: String?,
    @SerializedName("created_at") val createdAt: String
)

data class EmitirNFeRequest(
    @SerializedName("pedido_id") val pedidoId: Int,
    @SerializedName("natureza_operacao") val naturezaOperacao: String = "VENDA",
    @SerializedName("observacoes") val observacoes: String? = null
)

data class CancelarNFeRequest(
    @SerializedName("justificativa") val justificativa: String
)

data class DanfeUrlDto(
    @SerializedName("url") val url: String
)

data class XmlUrlDto(
    @SerializedName("url") val url: String
)

data class ResumoNFeDto(
    @SerializedName("total_emitidas") val totalEmitidas: Int,
    @SerializedName("total_autorizadas") val totalAutorizadas: Int,
    @SerializedName("total_canceladas") val totalCanceladas: Int,
    @SerializedName("valor_total") val valorTotal: Double
)
