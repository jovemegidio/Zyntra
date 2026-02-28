package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.RHRepository
import javax.inject.Inject

class GetFuncionariosUseCase @Inject constructor(
    private val rhRepository: RHRepository
) {
    suspend operator fun invoke(
        page: Int = 1, search: String? = null, departamento: String? = null
    ): Resource<List<Funcionario>> {
        return rhRepository.getFuncionarios(
            page = page, search = search?.takeIf { it.isNotBlank() }, departamento = departamento
        )
    }
}

class GetFuncionarioDetalheUseCase @Inject constructor(
    private val rhRepository: RHRepository
) {
    suspend operator fun invoke(id: Int): Resource<Funcionario> {
        if (id <= 0) return Resource.error("ID do funcionário inválido")
        return rhRepository.getFuncionarioById(id)
    }
}

class RegistrarPontoUseCase @Inject constructor(
    private val rhRepository: RHRepository
) {
    suspend operator fun invoke(
        funcionarioId: Int, tipo: String, observacao: String? = null
    ): Resource<RegistroPonto> {
        val tiposValidos = listOf("entrada", "saida_almoco", "retorno_almoco", "saida")
        if (tipo !in tiposValidos) return Resource.error("Tipo de ponto inválido: $tipo")
        return rhRepository.registrarPonto(funcionarioId, tipo, observacao)
    }
}

class GetPontoHojeUseCase @Inject constructor(
    private val rhRepository: RHRepository
) {
    suspend operator fun invoke(funcionarioId: Int): Resource<RegistroPonto> {
        return rhRepository.getPontoHoje(funcionarioId)
    }
}

class GetHoleritesUseCase @Inject constructor(
    private val rhRepository: RHRepository
) {
    suspend operator fun invoke(funcionarioId: Int, ano: Int? = null): Resource<List<Holerite>> {
        return rhRepository.getHolerites(funcionarioId, ano)
    }
}

class GetDepartamentosUseCase @Inject constructor(
    private val rhRepository: RHRepository
) {
    suspend operator fun invoke(): Resource<List<String>> {
        return rhRepository.getDepartamentos()
    }
}
