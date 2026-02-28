package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.DashboardPCP
import br.com.aluforce.erp.domain.repository.PCPRepository
import javax.inject.Inject

class GetOrdensProducaoUseCase @Inject constructor(
    private val pcpRepository: PCPRepository
) {
    suspend operator fun invoke(
        page: Int = 1, search: String? = null, status: String? = null
    ): Resource<List<OrdemProducaoResumo>> {
        return pcpRepository.getOrdens(
            page = page, search = search?.takeIf { it.isNotBlank() }, status = status
        )
    }
}

class GetOrdemDetalheUseCase @Inject constructor(
    private val pcpRepository: PCPRepository
) {
    suspend operator fun invoke(id: Int): Resource<OrdemProducao> {
        if (id <= 0) return Resource.error("ID da ordem inválido")
        return pcpRepository.getOrdemById(id)
    }
}

class UpdateOrdemStatusUseCase @Inject constructor(
    private val pcpRepository: PCPRepository
) {
    suspend operator fun invoke(id: Int, status: String, observacao: String? = null): Resource<OrdemProducao> {
        val allowed = listOf("planejada", "em_producao", "pausada", "concluida", "cancelada")
        if (status.lowercase() !in allowed) return Resource.error("Status inválido: $status")
        return pcpRepository.updateOrdemStatus(id, status, observacao)
    }
}

class CreateApontamentoUseCase @Inject constructor(
    private val pcpRepository: PCPRepository
) {
    suspend operator fun invoke(
        ordemId: Int, tipo: String, quantidade: Double, observacao: String? = null
    ): Resource<Apontamento> {
        if (quantidade <= 0) return Resource.error("Quantidade deve ser maior que zero")
        return pcpRepository.createApontamento(ordemId, tipo, quantidade, observacao)
    }
}

class GetDashboardPCPUseCase @Inject constructor(
    private val pcpRepository: PCPRepository
) {
    suspend operator fun invoke(): Resource<DashboardPCP> {
        return pcpRepository.getDashboardPCP()
    }
}
