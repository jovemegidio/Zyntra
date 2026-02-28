package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.NFeRepository
import javax.inject.Inject

class GetNotasFiscaisUseCase @Inject constructor(
    private val nfeRepository: NFeRepository
) {
    suspend operator fun invoke(
        page: Int = 1, status: String? = null, search: String? = null, tipo: String? = null
    ): Resource<List<NotaFiscal>> {
        return nfeRepository.getNotasFiscais(
            page = page, status = status, search = search?.takeIf { it.isNotBlank() }, tipo = tipo
        )
    }
}

class GetNotaFiscalDetalheUseCase @Inject constructor(
    private val nfeRepository: NFeRepository
) {
    suspend operator fun invoke(id: Int): Resource<NotaFiscal> {
        if (id <= 0) return Resource.error("ID da nota fiscal inválido")
        return nfeRepository.getNotaFiscalById(id)
    }
}

class EmitirNFeUseCase @Inject constructor(
    private val nfeRepository: NFeRepository
) {
    suspend operator fun invoke(
        pedidoId: Int, naturezaOperacao: String? = null, observacoes: String? = null
    ): Resource<NotaFiscal> {
        if (pedidoId <= 0) return Resource.error("ID do pedido inválido")
        return nfeRepository.emitirNotaFiscal(pedidoId, naturezaOperacao, observacoes)
    }
}

class CancelarNFeUseCase @Inject constructor(
    private val nfeRepository: NFeRepository
) {
    suspend operator fun invoke(id: Int, motivo: String): Resource<NotaFiscal> {
        if (motivo.length < 15) return Resource.error("Justificativa deve ter pelo menos 15 caracteres")
        return nfeRepository.cancelarNotaFiscal(id, motivo)
    }
}

class GetDanfeUrlUseCase @Inject constructor(
    private val nfeRepository: NFeRepository
) {
    suspend operator fun invoke(id: Int): Resource<String> {
        return nfeRepository.getDanfeUrl(id)
    }
}
