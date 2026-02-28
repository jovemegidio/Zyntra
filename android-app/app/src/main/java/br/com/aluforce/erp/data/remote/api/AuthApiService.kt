package br.com.aluforce.erp.data.remote.api

import br.com.aluforce.erp.core.network.ApiResponse
import br.com.aluforce.erp.data.remote.dto.LoginRequest
import br.com.aluforce.erp.data.remote.dto.LoginResponse
import br.com.aluforce.erp.data.remote.dto.RefreshTokenRequest
import br.com.aluforce.erp.data.remote.dto.RefreshTokenResponse
import br.com.aluforce.erp.data.remote.dto.UserProfileDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/**
 * Retrofit service for authentication endpoints.
 * Maps to: /api/v1/auth/
 */
interface AuthApiService {

    /**
     * Authenticate user with email and password.
     * POST /api/v1/auth/login
     */
    @POST("auth/login")
    suspend fun login(
        @Body request: LoginRequest
    ): Response<ApiResponse<LoginResponse>>

    /**
     * Refresh access token using refresh token.
     * POST /api/v1/auth/refresh
     */
    @POST("auth/refresh")
    suspend fun refreshToken(
        @Body request: RefreshTokenRequest
    ): Response<ApiResponse<RefreshTokenResponse>>

    /**
     * Logout and invalidate session.
     * POST /api/v1/auth/logout
     */
    @POST("auth/logout")
    suspend fun logout(): Response<ApiResponse<Unit>>

    /**
     * Get current user profile and permissions.
     * GET /api/v1/auth/me
     */
    @GET("auth/me")
    suspend fun getCurrentUser(): Response<ApiResponse<UserProfileDto>>
}
