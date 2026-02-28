package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.DashboardKpisDto
import br.com.aluforce.erp.data.remote.dto.NotificationDto
import br.com.aluforce.erp.data.remote.dto.PendingApprovalDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * Retrofit service for dashboard endpoints.
 * Maps to: /api/v1/dashboard/
 */
interface DashboardApiService {

    /**
     * Get dashboard KPIs summary.
     * GET /api/v1/dashboard/kpis
     */
    @GET("dashboard/kpis")
    suspend fun getKpis(
        @Query("period") period: String = "month" // day, week, month, year
    ): Response<ApiResponse<DashboardKpisDto>>

    /**
     * Get recent notifications for current user.
     * GET /api/v1/notifications
     */
    @GET("notifications")
    suspend fun getNotifications(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("unread_only") unreadOnly: Boolean = false
    ): Response<ApiResponse<List<NotificationDto>>>

    /**
     * Get pending approvals for current user.
     * GET /api/v1/dashboard/approvals/pending
     */
    @GET("dashboard/approvals/pending")
    suspend fun getPendingApprovals(): Response<ApiResponse<List<PendingApprovalDto>>>
}
