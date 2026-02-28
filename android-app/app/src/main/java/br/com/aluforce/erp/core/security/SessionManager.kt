package br.com.aluforce.erp.core.security

import br.com.aluforce.erp.data.remote.api.AuthApiService
import br.com.aluforce.erp.data.remote.dto.RefreshTokenRequest
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages user session lifecycle.
 *
 * Responsibilities:
 * - Track session state (active, expired, logged out)
 * - Handle token refresh
 * - Emit session events for UI navigation
 * - Enforce inactivity timeout
 */
@Singleton
class SessionManager @Inject constructor(
    private val tokenManager: TokenManager,
    private val authApiService: AuthApiService
) {

    /**
     * Session events that the UI observes to react accordingly.
     */
    sealed class SessionEvent {
        data object SessionExpired : SessionEvent()
        data object ForceLogout : SessionEvent()
        data object SessionRefreshed : SessionEvent()
    }

    private val _sessionEvents = MutableSharedFlow<SessionEvent>(replay = 0)
    val sessionEvents: SharedFlow<SessionEvent> = _sessionEvents.asSharedFlow()

    private var lastActivityTimestamp: Long = System.currentTimeMillis()

    /**
     * Record user activity to reset inactivity timer.
     */
    fun recordActivity() {
        lastActivityTimestamp = System.currentTimeMillis()
    }

    /**
     * Check if session has timed out due to inactivity.
     * @param timeoutMs Inactivity timeout in milliseconds (default: 30 min)
     */
    fun isSessionTimedOut(timeoutMs: Long = 30 * 60 * 1000): Boolean {
        return System.currentTimeMillis() - lastActivityTimestamp > timeoutMs
    }

    /**
     * Attempt to refresh the access token using the refresh token.
     * @return true if refresh succeeded, false otherwise
     */
    suspend fun refreshToken(): Boolean {
        return try {
            val refreshToken = tokenManager.getRefreshToken()
            if (refreshToken.isNullOrBlank()) {
                Timber.w("No refresh token available for refresh")
                return false
            }

            val deviceId = tokenManager.getDeviceId()
            val response = authApiService.refreshToken(
                RefreshTokenRequest(refreshToken = refreshToken, deviceId = deviceId)
            )

            if (response.isSuccessful && response.body()?.success == true) {
                val data = response.body()?.data
                if (data != null) {
                    tokenManager.saveAccessToken(
                        token = data.token,
                        expiryMs = 8 * 60 * 60 * 1000 // 8 hours
                    )
                    data.refreshToken?.let { tokenManager.saveRefreshToken(it) }
                    _sessionEvents.emit(SessionEvent.SessionRefreshed)
                    Timber.i("Token refreshed successfully")
                    return true
                }
            }

            Timber.w("Token refresh failed: ${response.code()}")
            false
        } catch (e: Exception) {
            Timber.e(e, "Token refresh error")
            false
        }
    }

    /**
     * Clear session and notify UI to navigate to login.
     */
    suspend fun clearSession() {
        tokenManager.clearAll()
        _sessionEvents.emit(SessionEvent.SessionExpired)
        Timber.i("Session cleared, emitting SessionExpired event")
    }

    /**
     * Force logout (e.g., remote wipe, admin action).
     */
    suspend fun forceLogout() {
        tokenManager.clearAll()
        _sessionEvents.emit(SessionEvent.ForceLogout)
        Timber.w("Force logout triggered")
    }

    /**
     * Get user display name from stored session.
     */
    suspend fun getUserName(): String? = tokenManager.getUserName()

    /**
     * Get user email from stored session.
     */
    suspend fun getUserEmail(): String? = tokenManager.getUserEmail()
}
