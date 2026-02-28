package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*

interface RHRepository {
    suspend fun getFuncionarios(page: Int = 1, perPage: Int = 20, search: String? = null, departamento: String? = null): Resource<List<Funcionario>>
    suspend fun getFuncionarioById(id: Int): Resource<Funcionario>
    suspend fun getRegistrosPonto(funcionarioId: Int? = null, data: String? = null, page: Int = 1): Resource<List<RegistroPonto>>
    suspend fun registrarPonto(funcionarioId: Int, tipo: String, observacao: String?): Resource<RegistroPonto>
    suspend fun getPontoHoje(funcionarioId: Int): Resource<RegistroPonto>
    suspend fun getHolerites(funcionarioId: Int, ano: Int? = null): Resource<List<Holerite>>
    suspend fun getDepartamentos(): Resource<List<String>>
}
