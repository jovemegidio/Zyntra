package br.com.aluforce.erp.core.network

import br.com.aluforce.erp.core.security.TokenManager
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp Interceptor that adds authentication headers to every request.
 *
 * Headers added:
 * - Authorization: Bearer <token>
 * - X-Device-Id: <unique device identifier>
 * - X-Request-Id: <UUID per request for tracing>
 * - X-App-Version: <app version>
 * - X-Platform: Android
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Skip auth for login/refresh endpoints
        val path = originalRequest.url.encodedPath
        if (path.contains("/auth/login") || path.contains("/auth/refresh")) {
            return chain.proceed(originalRequest)
        }

        val token = runBlocking { tokenManager.getAccessToken() }
        val deviceId = runBlocking { tokenManager.getDeviceId() }

        val authenticatedRequest = originalRequest.newBuilder().apply {
            if (!token.isNullOrBlank()) {
                header("Authorization", "Bearer $token")
            }
            if (!deviceId.isNullOrBlank()) {
                header("X-Device-Id", deviceId)
            }
            header("X-Request-Id", UUID.randomUUID().toString())
            header("X-Platform", "Android")
            header("X-App-Version", br.com.aluforce.erp.BuildConfig.VERSION_NAME)
            header("Content-Type", "application/json")
            header("Accept", "application/json")
        }.build()

        return chain.proceed(authenticatedRequest)
    }
}
