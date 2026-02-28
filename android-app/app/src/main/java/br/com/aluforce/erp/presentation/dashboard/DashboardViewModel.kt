package br.com.aluforce.erp.presentation.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.DashboardKpis
import br.com.aluforce.erp.domain.model.Notification
import br.com.aluforce.erp.domain.usecase.GetDashboardKpisUseCase
import br.com.aluforce.erp.domain.usecase.GetNotificationsUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val getDashboardKpisUseCase: GetDashboardKpisUseCase,
    private val getNotificationsUseCase: GetNotificationsUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        loadDashboard()
    }

    fun loadDashboard() {
        loadKpis()
        loadNotifications()
    }

    fun refreshDashboard() {
        _uiState.update { it.copy(isRefreshing = true) }
        loadKpis()
        loadNotifications()
    }

    private fun loadKpis() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingKpis = true) }

            when (val result = getDashboardKpisUseCase()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            kpis = result.data,
                            isLoadingKpis = false,
                            isRefreshing = false,
                            kpiError = null
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoadingKpis = false,
                            isRefreshing = false,
                            kpiError = result.message
                        )
                    }
                }
                is Resource.Loading -> { /* Already handled */ }
            }
        }
    }

    private fun loadNotifications() {
        viewModelScope.launch {
            when (val result = getNotificationsUseCase(unreadOnly = true)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            notifications = result.data,
                            unreadCount = result.data.count { n -> !n.lida }
                        )
                    }
                }
                is Resource.Error -> { /* Silent fail for notifications */ }
                is Resource.Loading -> {}
            }
        }
    }

    fun selectPeriod(period: String) {
        _uiState.update { it.copy(selectedPeriod = period) }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingKpis = true) }
            when (val result = getDashboardKpisUseCase(period)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(kpis = result.data, isLoadingKpis = false, kpiError = null)
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoadingKpis = false, kpiError = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }
}

data class DashboardUiState(
    val kpis: DashboardKpis? = null,
    val notifications: List<Notification> = emptyList(),
    val unreadCount: Int = 0,
    val isLoadingKpis: Boolean = false,
    val isRefreshing: Boolean = false,
    val selectedPeriod: String = "month",
    val kpiError: String? = null
)
