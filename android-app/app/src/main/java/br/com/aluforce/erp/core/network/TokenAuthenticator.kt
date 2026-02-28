package br.com.aluforce.erp.core.network

import br.com.aluforce.erp.core.security.SessionManager
import br.com.aluforce.erp.core.security.TokenManager
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp Authenticator that handles 401 responses automatically.
 *
 * Flow:
 * 1. Request returns 401
 * 2. Attempt to refresh token using refresh token
 * 3. If refresh succeeds → retry original request with new token
 * 4. If refresh fails → clear session, navigate to login
 *
 * Thread-safe: Uses Mutex to prevent multiple simultaneous refresh attempts.
 *
 * Uses dagger.Lazy to break the dependency cycle:
 * SessionManager → AuthApiService → Retrofit → OkHttpClient → TokenAuthenticator
 */
@Singleton
class TokenAuthenticator @Inject constructor(
    private val tokenManager: TokenManager,
    private val lazySessionManager: dagger.Lazy<SessionManager>
) : Authenticator {

    private val sessionManager: SessionManager get() = lazySessionManager.get()

    private val refreshMutex = Mutex()

    override fun authenticate(route: Route?, response: Response): Request? {
        // Prevent infinite refresh loops
        if (response.request.header("X-Retry-After-Refresh") != null) {
            Timber.w("Token refresh already attempted, giving up")
            runBlocking { sessionManager.clearSession() }
            return null
        }

        return runBlocking {
            refreshMutex.withLock {
                // Check if another thread already refreshed the token
                val currentToken = tokenManager.getAccessToken()
                val requestToken = response.request.header("Authorization")
                    ?.removePrefix("Bearer ")

                if (currentToken != null && currentToken != requestToken) {
                    // Token was already refreshed by another thread, retry with new token
                    Timber.d("Token already refreshed by another thread, retrying")
                    return@runBlocking retryWithToken(response.request, currentToken)
                }

                // Attempt token refresh
                val refreshToken = tokenManager.getRefreshToken()
                if (refreshToken.isNullOrBlank()) {
                    Timber.w("No refresh token available, clearing session")
                    sessionManager.clearSession()
                    return@runBlocking null
                }

                try {
                    // Use the auth API to refresh
                    // Note: This is handled via event bus to avoid circular dependency
                    // The actual refresh call is made by SessionManager
                    val refreshed = sessionManager.refreshToken()

                    if (refreshed) {
                        val newToken = tokenManager.getAccessToken()
                        Timber.i("Token refreshed successfully")
                        return@runBlocking retryWithToken(response.request, newToken!!)
                    } else {
                        Timber.w("Token refresh failed, clearing session")
                        sessionManager.clearSession()
                        return@runBlocking null
                    }
                } catch (e: Exception) {
                    Timber.e(e, "Token refresh error")
                    sessionManager.clearSession()
                    return@runBlocking null
                }
            }
        }
    }

    private fun retryWithToken(request: Request, token: String): Request {
        return request.newBuilder()
            .header("Authorization", "Bearer $token")
            .header("X-Retry-After-Refresh", "true")
            .build()
    }
}
