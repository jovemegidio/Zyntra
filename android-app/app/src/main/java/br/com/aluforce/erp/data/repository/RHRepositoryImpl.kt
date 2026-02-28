package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.RHApiService
import br.com.aluforce.erp.data.remote.dto.*
import br.com.aluforce.erp.data.remote.mapper.RHMapper.toDomain
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.RHRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RHRepositoryImpl @Inject constructor(
    private val rhApiService: RHApiService
) : RHRepository {

    override suspend fun getFuncionarios(
        page: Int, perPage: Int, search: String?, departamento: String?
    ): Resource<List<Funcionario>> {
        return NetworkErrorHandler.safeApiCall {
            rhApiService.getFuncionarios(page = page, perPage = perPage, search = search, departamento = departamento)
        }.map { list -> list.map { it.toDomain() } }
    }

    override suspend fun getFuncionarioById(id: Int): Resource<Funcionario> {
        return NetworkErrorHandler.safeApiCall {
            rhApiService.getFuncionarioById(id)
        }.map { it.toDomain() }
    }

    override suspend fun getRegistrosPonto(
        funcionarioId: Int?, data: String?, page: Int
    ): Resource<List<RegistroPonto>> {
        return NetworkErrorHandler.safeApiCall {
            rhApiService.getRegistrosPonto(funcionarioId = funcionarioId, dataInicio = data, page = page)
        }.map { list -> list.map { dto: RegistroPontoDto -> dto.toDomain() } }
    }

    override suspend fun registrarPonto(
        funcionarioId: Int, tipo: String, observacao: String?
    ): Resource<RegistroPonto> {
        val request = RegistrarPontoRequest(tipo = tipo)
        return NetworkErrorHandler.safeApiCall {
            rhApiService.registrarPonto(request)
        }.map { dto: RegistroPontoDto -> dto.toDomain() }
    }

    override suspend fun getPontoHoje(funcionarioId: Int): Resource<RegistroPonto> {
        return NetworkErrorHandler.safeApiCall {
            rhApiService.getPontoHoje()
        }.map { dto: RegistroPontoDto -> dto.toDomain() }
    }

    override suspend fun getHolerites(funcionarioId: Int, ano: Int?): Resource<List<Holerite>> {
        return NetworkErrorHandler.safeApiCall {
            rhApiService.getHolerites(funcionarioId = funcionarioId, ano = ano)
        }.map { list -> list.map { dto: HoleriteDto -> dto.toDomain() } }
    }

    override suspend fun getDepartamentos(): Resource<List<String>> {
        return NetworkErrorHandler.safeApiCall {
            rhApiService.getDepartamentos()
        }.map { list -> list.map { it.nome } }
    }
}
