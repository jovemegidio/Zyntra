package br.com.aluforce.erp.data.remote.mapper

import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.domain.model.*

/**
 * Mappers for Clientes, Compras, PCP, Financeiro, RH, NFe modules.
 * DTO -> Domain Model conversions.
 */

object ClientesMapper {
    fun HistoricoClienteDto.toDomain(): ClienteHistorico = ClienteHistorico(
        id = id, acao = acao, descricao = descricao, usuario = usuario, createdAt = createdAt
    )
}

object ComprasMapper {
    fun PedidoCompraListDto.toDomain(): PedidoCompraResumo = PedidoCompraResumo(
        id = id, numero = numero ?: "#$id", fornecedorNome = fornecedorNome,
        fornecedorId = fornecedorId, valorTotal = valorTotal,
        status = CompraStatus.fromString(status), dataPedido = dataPedido,
        prazoEntrega = prazoEntrega, comprador = comprador, createdAt = createdAt
    )

    fun PedidoCompraDetalheDto.toDomain(): PedidoCompra = PedidoCompra(
        id = id, numero = numero ?: "#$id",
        fornecedor = FornecedorResumo(fornecedor.id, fornecedor.nome, fornecedor.cnpj, fornecedor.email, fornecedor.telefone),
        itens = itens.map { ItemCompra(it.id, it.produtoId, it.descricao, it.quantidade, it.precoUnitario, it.desconto ?: 0.0, it.valorTotal, it.unidade ?: "UN") },
        valorTotal = valorTotal, valorDesconto = valorDesconto ?: 0.0, valorFrete = valorFrete ?: 0.0,
        status = CompraStatus.fromString(status), observacoes = observacoes,
        condicaoPagamento = condicaoPagamento, formaPagamento = formaPagamento,
        dataPedido = dataPedido, prazoEntrega = prazoEntrega, comprador = comprador,
        createdAt = createdAt, updatedAt = updatedAt
    )

    fun FornecedorDto.toDomain(): Fornecedor = Fornecedor(
        id = id, nome = nome, razaoSocial = razaoSocial, cnpj = cnpj, cpf = cpf,
        email = email, telefone = telefone, celular = celular, endereco = endereco,
        cidade = cidade, estado = estado, cep = cep, contatoPrincipal = contatoPrincipal,
        segmento = segmento, status = status ?: "ativo", observacoes = observacoes,
        totalPedidos = totalPedidos ?: 0, valorTotalCompras = valorTotalCompras ?: 0.0,
        avaliacao = avaliacao, createdAt = createdAt
    )
}

object PCPMapper {
    fun OrdemProducaoListDto.toDomain(): OrdemProducaoResumo = OrdemProducaoResumo(
        id = id, numero = numero ?: "#$id", produto = produto, quantidade = quantidade,
        quantidadeProduzida = quantidadeProduzida ?: 0.0,
        status = OrdemStatus.fromString(status), prioridade = prioridade,
        dataInicio = dataInicio, dataPrevisao = dataPrevisao,
        responsavel = responsavel, createdAt = createdAt
    )

    fun OrdemProducaoDetalheDto.toDomain(): OrdemProducao = OrdemProducao(
        id = id, numero = numero ?: "#$id", produto = produto, produtoId = produtoId,
        quantidade = quantidade, quantidadeProduzida = quantidadeProduzida ?: 0.0,
        unidade = unidade ?: "UN", status = OrdemStatus.fromString(status),
        prioridade = prioridade, observacoes = observacoes, dataInicio = dataInicio,
        dataPrevisao = dataPrevisao, dataConclusao = dataConclusao, responsavel = responsavel,
        etapas = etapas?.map { EtapaProducao(it.id, it.nome, it.ordem, it.status ?: "pendente", it.tempoEstimado, it.tempoReal, it.responsavel) } ?: emptyList(),
        apontamentos = apontamentos?.map { it.toDomain() } ?: emptyList(),
        materiaisConsumidos = materiais?.map { MaterialConsumido(it.id, it.produtoId, it.descricao, it.quantidade, it.unidade ?: "UN") } ?: emptyList(),
        createdAt = createdAt, updatedAt = updatedAt
    )

    fun ApontamentoDto.toDomain(): Apontamento = Apontamento(
        id = id, ordemId = ordemId, tipo = tipo, quantidade = quantidade,
        observacao = observacao, operador = operador, dataHora = dataHora, createdAt = createdAt
    )
}

object FinanceiroMapper {
    fun ContaPagarDto.toDomain(): ContaPagar = ContaPagar(
        id = id, descricao = descricao, fornecedor = fornecedor, fornecedorId = fornecedorId,
        valor = valor, valorPago = valorPago ?: 0.0, dataVencimento = dataVencimento,
        dataPagamento = dataPagamento, status = ContaStatus.fromString(status),
        categoria = categoria, centroCusto = centroCusto, formaPagamento = formaPagamento,
        observacoes = observacoes, parcela = parcela, createdAt = createdAt
    )

    fun ContaReceberDto.toDomain(): ContaReceber = ContaReceber(
        id = id, descricao = descricao, cliente = cliente, clienteId = clienteId,
        valor = valor, valorRecebido = valorRecebido ?: 0.0, dataVencimento = dataVencimento,
        dataRecebimento = dataRecebimento, status = ContaStatus.fromString(status),
        categoria = categoria, centroCusto = centroCusto, formaPagamento = formaPagamento,
        observacoes = observacoes, parcela = parcela, pedidoId = pedidoId, createdAt = createdAt
    )

    fun FluxoCaixaDto.toDomain(): FluxoCaixa = FluxoCaixa(
        periodo = periodo, saldoInicial = saldoInicial, totalEntradas = totalEntradas,
        totalSaidas = totalSaidas, saldoFinal = saldoFinal,
        movimentacoes = movimentacoes?.map { MovimentacaoFinanceira(it.id, it.tipo, it.descricao, it.valor, it.data, it.categoria, it.conta) } ?: emptyList()
    )

    fun ResumoFinanceiroDto.toDomain(): ResumoFinanceiro = ResumoFinanceiro(
        totalReceitas = totalReceitas, totalDespesas = totalDespesas, saldo = saldo,
        contasPagarVencidas = contasPagarVencidas, contasPagarHoje = contasPagarHoje,
        contasReceberVencidas = contasReceberVencidas, contasReceberHoje = contasReceberHoje,
        fluxoMensal = fluxoMensal?.map { FluxoMensal(it.mes, it.entradas, it.saidas, it.saldo) } ?: emptyList()
    )
}

object RHMapper {
    fun FuncionarioDto.toDomain(): Funcionario = Funcionario(
        id = id, nome = nome, cpf = cpf, email = email, telefone = telefone,
        cargo = cargo, departamento = departamento, dataAdmissao = dataAdmissao,
        dataDemissao = dataDemissao, salario = salario, status = status ?: "ativo",
        avatar = avatar, endereco = endereco, cidade = cidade, estado = estado,
        createdAt = createdAt
    )

    fun RegistroPontoDto.toDomain(): RegistroPonto = RegistroPonto(
        id = id, funcionarioId = funcionarioId, funcionarioNome = funcionarioNome,
        data = data, entrada = entrada, saidaAlmoco = saidaAlmoco,
        retornoAlmoco = retornoAlmoco, saida = saida,
        horasTrabalhadas = horasTrabalhadas, horasExtras = horasExtras,
        observacao = observacao, status = status ?: "normal"
    )

    fun HoleriteDto.toDomain(): Holerite = Holerite(
        id = id, funcionarioId = funcionarioId, competencia = competencia,
        salarioBruto = salarioBruto, descontos = descontos, salarioLiquido = salarioLiquido,
        status = status ?: "gerado",
        detalhes = detalhes?.map { ItemHolerite(it.descricao, it.tipo, it.valor) } ?: emptyList()
    )
}

object NFeMapper {
    fun NotaFiscalDto.toDomain(): NotaFiscal = NotaFiscal(
        id = id, numero = numero, serie = serie, chaveAcesso = chaveAcesso,
        tipo = tipo ?: "NFe", naturezaOperacao = naturezaOperacao,
        destinatario = destinatario, destinatarioCnpj = destinatarioCnpj,
        valorTotal = valorTotal, status = NFeStatus.fromString(status),
        dataEmissao = dataEmissao, dataAutorizacao = dataAutorizacao,
        protocolo = protocolo, pedidoId = pedidoId, observacoes = observacoes,
        createdAt = createdAt
    )
}
