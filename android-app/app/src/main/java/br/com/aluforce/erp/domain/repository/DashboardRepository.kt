package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.PaginatedResult
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.DashboardKpis
import br.com.aluforce.erp.domain.model.Notification

/**
 * Dashboard repository interface (Domain layer).
 */
interface DashboardRepository {

    suspend fun getKpis(period: String = "month"): Resource<DashboardKpis>

    suspend fun getNotifications(
        page: Int = 1,
        perPage: Int = 20,
        unreadOnly: Boolean = false
    ): Resource<List<Notification>>
}
