package br.com.aluforce.erp.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.AuthResult
import br.com.aluforce.erp.domain.usecase.CheckSessionUseCase
import br.com.aluforce.erp.domain.usecase.LoginUseCase
import br.com.aluforce.erp.domain.usecase.LogoutUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * ViewModel for authentication screens.
 *
 * State:
 * - loginState: Current state of login operation (idle, loading, success, error)
 * - isCheckingSession: Whether initial session check is in progress (splash)
 *
 * Events:
 * - navigateToLogin: One-shot navigation event
 * - navigateToDashboard: One-shot navigation event
 */
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val loginUseCase: LoginUseCase,
    private val logoutUseCase: LogoutUseCase,
    private val checkSessionUseCase: CheckSessionUseCase
) : ViewModel() {

    // ========== STATE ==========

    private val _loginState = MutableStateFlow<LoginState>(LoginState.Idle)
    val loginState: StateFlow<LoginState> = _loginState.asStateFlow()

    private val _isCheckingSession = MutableStateFlow(true)
    val isCheckingSession: StateFlow<Boolean> = _isCheckingSession.asStateFlow()

    // ========== EVENTS ==========

    private val _navigateToLogin = MutableSharedFlow<Boolean>()
    val navigateToLogin: SharedFlow<Boolean> = _navigateToLogin.asSharedFlow()

    private val _navigateToDashboard = MutableSharedFlow<Boolean>()
    val navigateToDashboard: SharedFlow<Boolean> = _navigateToDashboard.asSharedFlow()

    init {
        checkExistingSession()
    }

    /**
     * Check if user has a valid session on app startup.
     * Used by splash screen to decide initial navigation.
     */
    private fun checkExistingSession() {
        viewModelScope.launch {
            try {
                val hasSession = checkSessionUseCase()
                if (hasSession) {
                    Timber.i("Valid session found, navigating to dashboard")
                    _navigateToDashboard.emit(true)
                } else {
                    Timber.i("No valid session, navigating to login")
                    _navigateToLogin.emit(true)
                }
            } catch (e: Exception) {
                Timber.e(e, "Session check failed")
                _navigateToLogin.emit(true)
            } finally {
                _isCheckingSession.value = false
            }
        }
    }

    /**
     * Perform login with email and password.
     */
    fun login(email: String, password: String) {
        if (_loginState.value is LoginState.Loading) return

        viewModelScope.launch {
            _loginState.value = LoginState.Loading

            when (val result = loginUseCase(email, password)) {
                is Resource.Success -> {
                    _loginState.value = LoginState.Success(result.data)
                    _navigateToDashboard.emit(true)
                    Timber.i("Login successful")
                }
                is Resource.Error -> {
                    _loginState.value = LoginState.Error(result.message)
                    Timber.w("Login failed: ${result.message}")
                }
                is Resource.Loading -> { /* Already set */ }
            }
        }
    }

    /**
     * Perform logout.
     */
    fun logout() {
        viewModelScope.launch {
            logoutUseCase()
            _loginState.value = LoginState.Idle
            _navigateToLogin.emit(true)
        }
    }

    /**
     * Reset login state (e.g., dismiss error).
     */
    fun resetLoginState() {
        _loginState.value = LoginState.Idle
    }
}

/**
 * Sealed class representing login UI states.
 */
sealed class LoginState {
    data object Idle : LoginState()
    data object Loading : LoginState()
    data class Success(val authResult: AuthResult) : LoginState()
    data class Error(val message: String) : LoginState()
}
