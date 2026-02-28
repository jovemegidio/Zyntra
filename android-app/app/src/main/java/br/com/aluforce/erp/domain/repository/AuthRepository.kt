package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.AuthResult
import br.com.aluforce.erp.domain.model.UserProfile

/**
 * Auth repository interface (Domain layer).
 * Implementation is in data layer — decoupled from API details.
 */
interface AuthRepository {

    /**
     * Authenticate user with email and password.
     */
    suspend fun login(email: String, password: String): Resource<AuthResult>

    /**
     * Get current user profile from API.
     */
    suspend fun getCurrentUser(): Resource<UserProfile>

    /**
     * Logout current session.
     */
    suspend fun logout(): Resource<Unit>

    /**
     * Check if user has a valid local session.
     */
    suspend fun hasValidSession(): Boolean
}
