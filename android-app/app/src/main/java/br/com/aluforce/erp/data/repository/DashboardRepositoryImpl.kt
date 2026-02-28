package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.data.remote.api.DashboardApiService
import br.com.aluforce.erp.data.remote.mapper.DashboardMapper.toDomain
import br.com.aluforce.erp.domain.model.DashboardKpis
import br.com.aluforce.erp.domain.model.Notification
import br.com.aluforce.erp.domain.repository.DashboardRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DashboardRepositoryImpl @Inject constructor(
    private val dashboardApiService: DashboardApiService
) : DashboardRepository {

    override suspend fun getKpis(period: String): Resource<DashboardKpis> {
        return NetworkErrorHandler.safeApiCall {
            dashboardApiService.getKpis(period)
        }.map { it.toDomain() }
    }

    override suspend fun getNotifications(
        page: Int,
        perPage: Int,
        unreadOnly: Boolean
    ): Resource<List<Notification>> {
        return NetworkErrorHandler.safeApiCall {
            dashboardApiService.getNotifications(page, perPage, unreadOnly)
        }.map { list -> list.map { it.toDomain() } }
    }
}
