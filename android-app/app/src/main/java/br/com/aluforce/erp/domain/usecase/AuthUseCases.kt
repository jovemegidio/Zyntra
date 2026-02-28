package br.com.aluforce.erp.domain.usecase

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.AuthResult
import br.com.aluforce.erp.domain.model.UserProfile
import br.com.aluforce.erp.domain.repository.AuthRepository
import javax.inject.Inject

/**
 * Use case for user login.
 * Contains validation logic before delegating to repository.
 */
class LoginUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(email: String, password: String): Resource<AuthResult> {
        // Business validation
        if (email.isBlank()) {
            return Resource.error("E-mail é obrigatório", "VALIDATION_ERROR")
        }

        if (!email.contains("@")) {
            return Resource.error("E-mail inválido", "VALIDATION_ERROR")
        }

        if (password.isBlank()) {
            return Resource.error("Senha é obrigatória", "VALIDATION_ERROR")
        }

        if (password.length < 4) {
            return Resource.error("Senha deve ter pelo menos 4 caracteres", "VALIDATION_ERROR")
        }

        // Domain rule: Only allowed email domains
        val allowedDomains = listOf("aluforce.ind.br", "aluforce.com.br", "lumiereassessoria.com.br")
        val domain = email.substringAfter("@").lowercase()
        if (domain !in allowedDomains) {
            return Resource.error("Domínio de e-mail não autorizado", "INVALID_DOMAIN")
        }

        return authRepository.login(email.trim().lowercase(), password)
    }
}

/**
 * Use case for getting current user profile.
 */
class GetCurrentUserUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(): Resource<UserProfile> {
        return authRepository.getCurrentUser()
    }
}

/**
 * Use case for logging out.
 */
class LogoutUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(): Resource<Unit> {
        return authRepository.logout()
    }
}

/**
 * Use case for checking if user has a valid session.
 */
class CheckSessionUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(): Boolean {
        return authRepository.hasValidSession()
    }
}
