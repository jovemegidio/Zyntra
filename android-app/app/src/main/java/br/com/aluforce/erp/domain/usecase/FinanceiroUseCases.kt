package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.FinanceiroRepository
import javax.inject.Inject

class GetContasPagarUseCase @Inject constructor(
    private val financeiroRepository: FinanceiroRepository
) {
    suspend operator fun invoke(
        page: Int = 1, status: String? = null, search: String? = null
    ): Resource<List<ContaPagar>> {
        return financeiroRepository.getContasPagar(page = page, status = status, search = search?.takeIf { it.isNotBlank() })
    }
}

class GetContasReceberUseCase @Inject constructor(
    private val financeiroRepository: FinanceiroRepository
) {
    suspend operator fun invoke(
        page: Int = 1, status: String? = null, search: String? = null
    ): Resource<List<ContaReceber>> {
        return financeiroRepository.getContasReceber(page = page, status = status, search = search?.takeIf { it.isNotBlank() })
    }
}

class RegistrarPagamentoUseCase @Inject constructor(
    private val financeiroRepository: FinanceiroRepository
) {
    suspend operator fun invoke(
        id: Int, valorPago: Double, dataPagamento: String, formaPagamento: String? = null
    ): Resource<ContaPagar> {
        if (valorPago <= 0) return Resource.error("Valor do pagamento deve ser maior que zero")
        if (dataPagamento.isBlank()) return Resource.error("Data de pagamento é obrigatória")
        return financeiroRepository.registrarPagamento(id, valorPago, dataPagamento, formaPagamento)
    }
}

class RegistrarRecebimentoUseCase @Inject constructor(
    private val financeiroRepository: FinanceiroRepository
) {
    suspend operator fun invoke(
        id: Int, valorRecebido: Double, dataRecebimento: String, formaPagamento: String? = null
    ): Resource<ContaReceber> {
        if (valorRecebido <= 0) return Resource.error("Valor do recebimento deve ser maior que zero")
        if (dataRecebimento.isBlank()) return Resource.error("Data de recebimento é obrigatória")
        return financeiroRepository.registrarRecebimento(id, valorRecebido, dataRecebimento, formaPagamento)
    }
}

class GetFluxoCaixaUseCase @Inject constructor(
    private val financeiroRepository: FinanceiroRepository
) {
    suspend operator fun invoke(dataInicio: String, dataFim: String): Resource<FluxoCaixa> {
        return financeiroRepository.getFluxoCaixa(dataInicio, dataFim)
    }
}

class GetResumoFinanceiroUseCase @Inject constructor(
    private val financeiroRepository: FinanceiroRepository
) {
    suspend operator fun invoke(): Resource<ResumoFinanceiro> {
        return financeiroRepository.getResumoFinanceiro()
    }
}
