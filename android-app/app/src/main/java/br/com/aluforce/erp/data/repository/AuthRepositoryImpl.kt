package br.com.aluforce.erp.data.repository

import br.com.aluforce.erp.core.network.NetworkErrorHandler
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.core.security.TokenManager
import br.com.aluforce.erp.data.remote.api.AuthApiService
import br.com.aluforce.erp.data.remote.dto.LoginRequest
import br.com.aluforce.erp.data.remote.mapper.AuthMapper.toDomain
import br.com.aluforce.erp.domain.model.AuthResult
import br.com.aluforce.erp.domain.model.UserProfile
import br.com.aluforce.erp.domain.repository.AuthRepository
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AuthRepository implementation.
 * Handles login, token storage, and session management.
 */
@Singleton
class AuthRepositoryImpl @Inject constructor(
    private val authApiService: AuthApiService,
    private val tokenManager: TokenManager
) : AuthRepository {

    override suspend fun login(email: String, password: String): Resource<AuthResult> {
        val deviceId = tokenManager.getDeviceId()
        val request = LoginRequest(email = email, password = password, deviceId = deviceId)

        return try {
            val response = authApiService.login(request)

            if (response.isSuccessful && response.body()?.success == true) {
                val data = response.body()?.data
                if (data != null) {
                    // Save tokens securely
                    tokenManager.saveAccessToken(
                        token = data.token,
                        expiryMs = 8 * 60 * 60 * 1000 // 8 hours
                    )
                    data.refreshToken?.let { tokenManager.saveRefreshToken(it) }

                    // Save user info
                    tokenManager.saveUserInfo(
                        id = data.user.id.toString(),
                        name = data.user.nome,
                        email = data.user.email,
                        role = data.user.role,
                        avatar = data.user.avatar
                    )

                    Timber.i("Login successful for ${data.user.email}")
                    return Resource.success(
                        AuthResult(
                            token = data.token,
                            refreshToken = data.refreshToken,
                            user = data.user.toDomain()
                        )
                    )
                }
            }

            // Parse error from response
            val errorBody = response.errorBody()?.string()
            val message = try {
                val gson = com.google.gson.Gson()
                val apiError = gson.fromJson(errorBody, br.com.aluforce.erp.core.network.ApiResponse::class.java)
                apiError?.message ?: "Erro ao fazer login"
            } catch (e: Exception) {
                "E-mail ou senha incorretos"
            }

            Timber.w("Login failed: $message")
            Resource.error(message)
        } catch (e: Exception) {
            Timber.e(e, "Login error")
            NetworkErrorHandler.safeApiCall { authApiService.login(request) }
                .map { throw IllegalStateException("Should not reach here") }
                .let {
                    if (it is Resource.Error) Resource.error(it.message, it.code)
                    else Resource.error("Erro inesperado ao fazer login")
                }
        }
    }

    override suspend fun getCurrentUser(): Resource<UserProfile> {
        return NetworkErrorHandler.safeApiCall { authApiService.getCurrentUser() }
            .map { it.toDomain() }
    }

    override suspend fun logout(): Resource<Unit> {
        return try {
            authApiService.logout()
            tokenManager.clearAll()
            Timber.i("Logout successful")
            Resource.success(Unit)
        } catch (e: Exception) {
            // Even if API call fails, clear local session
            tokenManager.clearAll()
            Timber.w(e, "Logout API call failed, but local session cleared")
            Resource.success(Unit)
        }
    }

    override suspend fun hasValidSession(): Boolean {
        return tokenManager.hasValidSession()
    }
}
