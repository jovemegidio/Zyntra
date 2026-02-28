package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.DashboardKpis
import br.com.aluforce.erp.domain.model.Notification
import br.com.aluforce.erp.domain.repository.DashboardRepository
import javax.inject.Inject

/**
 * Use case for loading dashboard KPIs.
 */
class GetDashboardKpisUseCase @Inject constructor(
    private val dashboardRepository: DashboardRepository
) {
    suspend operator fun invoke(period: String = "month"): Resource<DashboardKpis> {
        return dashboardRepository.getKpis(period)
    }
}

/**
 * Use case for loading notifications.
 */
class GetNotificationsUseCase @Inject constructor(
    private val dashboardRepository: DashboardRepository
) {
    suspend operator fun invoke(
        page: Int = 1,
        unreadOnly: Boolean = false
    ): Resource<List<Notification>> {
        return dashboardRepository.getNotifications(page = page, unreadOnly = unreadOnly)
    }
}
