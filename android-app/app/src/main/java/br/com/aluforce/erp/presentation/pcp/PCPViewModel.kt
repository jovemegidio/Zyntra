package br.com.aluforce.erp.presentation.pcp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.repository.DashboardPCP
import br.com.aluforce.erp.domain.usecase.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PCPViewModel @Inject constructor(
    private val getOrdensProducaoUseCase: GetOrdensProducaoUseCase,
    private val getOrdemDetalheUseCase: GetOrdemDetalheUseCase,
    private val updateOrdemStatusUseCase: UpdateOrdemStatusUseCase,
    private val createApontamentoUseCase: CreateApontamentoUseCase,
    private val getDashboardPCPUseCase: GetDashboardPCPUseCase
) : ViewModel() {

    private val _listState = MutableStateFlow(OrdensListState())
    val listState: StateFlow<OrdensListState> = _listState.asStateFlow()

    private val _detailState = MutableStateFlow<OrdemDetailState>(OrdemDetailState.Idle)
    val detailState: StateFlow<OrdemDetailState> = _detailState.asStateFlow()

    private val _dashboardState = MutableStateFlow<PCPDashboardState>(PCPDashboardState.Loading)
    val dashboardState: StateFlow<PCPDashboardState> = _dashboardState.asStateFlow()

    private val _events = MutableSharedFlow<PCPEvent>()
    val events: SharedFlow<PCPEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init { loadOrdens(); loadDashboardPCP() }

    fun loadOrdens(refresh: Boolean = false) {
        if (refresh) _listState.update { it.copy(currentPage = 1, ordens = emptyList()) }
        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _listState.value
            when (val result = getOrdensProducaoUseCase(page = state.currentPage, search = state.searchQuery, status = state.statusFilter)) {
                is Resource.Success -> _listState.update {
                    it.copy(ordens = if (refresh) result.data else it.ordens + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _listState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadNextPage() {
        val s = _listState.value; if (s.isLoading || !s.hasMore) return
        _listState.update { it.copy(currentPage = it.currentPage + 1) }; loadOrdens()
    }

    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _listState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadOrdens(refresh = true)
        }
    }

    fun filterByStatus(status: String?) {
        _listState.update { it.copy(statusFilter = status) }; loadOrdens(refresh = true)
    }

    fun refresh() { loadOrdens(refresh = true); loadDashboardPCP() }

    fun loadOrdemDetail(id: Int) {
        viewModelScope.launch {
            _detailState.value = OrdemDetailState.Loading
            when (val result = getOrdemDetalheUseCase(id)) {
                is Resource.Success -> _detailState.value = OrdemDetailState.Success(result.data)
                is Resource.Error -> _detailState.value = OrdemDetailState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }

    fun updateOrdemStatus(ordemId: Int, newStatus: String, observacao: String? = null) {
        viewModelScope.launch {
            when (val result = updateOrdemStatusUseCase(ordemId, newStatus, observacao)) {
                is Resource.Success -> {
                    _detailState.value = OrdemDetailState.Success(result.data)
                    _events.emit(PCPEvent.StatusUpdated("Status atualizado"))
                    loadOrdens(refresh = true); loadDashboardPCP()
                }
                is Resource.Error -> _events.emit(PCPEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    fun createApontamento(ordemId: Int, tipo: String, quantidade: Double, observacao: String? = null) {
        viewModelScope.launch {
            when (val result = createApontamentoUseCase(ordemId, tipo, quantidade, observacao)) {
                is Resource.Success -> {
                    _events.emit(PCPEvent.ApontamentoCreated("Apontamento registrado"))
                    loadOrdemDetail(ordemId)
                }
                is Resource.Error -> _events.emit(PCPEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    private fun loadDashboardPCP() {
        viewModelScope.launch {
            _dashboardState.value = PCPDashboardState.Loading
            when (val result = getDashboardPCPUseCase()) {
                is Resource.Success -> _dashboardState.value = PCPDashboardState.Success(result.data)
                is Resource.Error -> _dashboardState.value = PCPDashboardState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }
}

data class OrdensListState(
    val ordens: List<OrdemProducaoResumo> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val statusFilter: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = ordens.isEmpty() && !isLoading }

sealed class OrdemDetailState {
    data object Idle : OrdemDetailState()
    data object Loading : OrdemDetailState()
    data class Success(val ordem: OrdemProducao) : OrdemDetailState()
    data class Error(val message: String) : OrdemDetailState()
}

sealed class PCPDashboardState {
    data object Loading : PCPDashboardState()
    data class Success(val dashboard: DashboardPCP) : PCPDashboardState()
    data class Error(val message: String) : PCPDashboardState()
}

sealed class PCPEvent {
    data class StatusUpdated(val message: String) : PCPEvent()
    data class ApontamentoCreated(val message: String) : PCPEvent()
    data class Error(val message: String) : PCPEvent()
}
