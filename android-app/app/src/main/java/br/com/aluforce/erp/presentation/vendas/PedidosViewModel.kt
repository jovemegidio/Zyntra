package br.com.aluforce.erp.presentation.vendas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.Pedido
import br.com.aluforce.erp.domain.model.PedidoResumo
import br.com.aluforce.erp.domain.usecase.GetPedidoDetalheUseCase
import br.com.aluforce.erp.domain.usecase.GetPedidosUseCase
import br.com.aluforce.erp.domain.usecase.UpdatePedidoStatusUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PedidosViewModel @Inject constructor(
    private val getPedidosUseCase: GetPedidosUseCase,
    private val getPedidoDetalheUseCase: GetPedidoDetalheUseCase,
    private val updatePedidoStatusUseCase: UpdatePedidoStatusUseCase
) : ViewModel() {

    // ========== LIST STATE ==========

    private val _listState = MutableStateFlow(PedidosListState())
    val listState: StateFlow<PedidosListState> = _listState.asStateFlow()

    // ========== DETAIL STATE ==========

    private val _detailState = MutableStateFlow<PedidoDetailState>(PedidoDetailState.Idle)
    val detailState: StateFlow<PedidoDetailState> = _detailState.asStateFlow()

    // ========== EVENTS ==========

    private val _events = MutableSharedFlow<PedidoEvent>()
    val events: SharedFlow<PedidoEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init {
        loadPedidos()
    }

    // ========== LIST OPERATIONS ==========

    fun loadPedidos(refresh: Boolean = false) {
        if (refresh) {
            _listState.update { it.copy(currentPage = 1, pedidos = emptyList()) }
        }

        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, isRefreshing = refresh) }

            val state = _listState.value
            when (val result = getPedidosUseCase(
                page = state.currentPage,
                search = state.searchQuery,
                status = state.statusFilter
            )) {
                is Resource.Success -> {
                    _listState.update {
                        it.copy(
                            pedidos = if (refresh) result.data else it.pedidos + result.data,
                            isLoading = false,
                            isRefreshing = false,
                            hasMore = result.data.size >= 20,
                            error = null
                        )
                    }
                }
                is Resource.Error -> {
                    _listState.update {
                        it.copy(isLoading = false, isRefreshing = false, error = result.message)
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadNextPage() {
        val state = _listState.value
        if (state.isLoading || !state.hasMore) return

        _listState.update { it.copy(currentPage = it.currentPage + 1) }
        loadPedidos()
    }

    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300) // Debounce
            _listState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadPedidos(refresh = true)
        }
    }

    fun filterByStatus(status: String?) {
        _listState.update { it.copy(statusFilter = status) }
        loadPedidos(refresh = true)
    }

    fun refresh() = loadPedidos(refresh = true)

    // ========== DETAIL OPERATIONS ==========

    fun loadPedidoDetail(id: Int) {
        viewModelScope.launch {
            _detailState.value = PedidoDetailState.Loading

            when (val result = getPedidoDetalheUseCase(id)) {
                is Resource.Success -> {
                    _detailState.value = PedidoDetailState.Success(result.data)
                }
                is Resource.Error -> {
                    _detailState.value = PedidoDetailState.Error(result.message)
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateStatus(pedidoId: Int, newStatus: String, observacao: String? = null) {
        viewModelScope.launch {
            _detailState.value = PedidoDetailState.Loading

            when (val result = updatePedidoStatusUseCase(pedidoId, newStatus, observacao)) {
                is Resource.Success -> {
                    _detailState.value = PedidoDetailState.Success(result.data)
                    _events.emit(PedidoEvent.StatusUpdated("Status atualizado com sucesso"))
                    // Refresh list
                    loadPedidos(refresh = true)
                }
                is Resource.Error -> {
                    _events.emit(PedidoEvent.Error(result.message))
                }
                is Resource.Loading -> {}
            }
        }
    }
}

// ========== STATE CLASSES ==========

data class PedidosListState(
    val pedidos: List<PedidoResumo> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val searchQuery: String? = null,
    val statusFilter: String? = null,
    val currentPage: Int = 1,
    val hasMore: Boolean = true
) {
    val isEmpty: Boolean get() = pedidos.isEmpty() && !isLoading
}

sealed class PedidoDetailState {
    data object Idle : PedidoDetailState()
    data object Loading : PedidoDetailState()
    data class Success(val pedido: Pedido) : PedidoDetailState()
    data class Error(val message: String) : PedidoDetailState()
}

sealed class PedidoEvent {
    data class StatusUpdated(val message: String) : PedidoEvent()
    data class Error(val message: String) : PedidoEvent()
}
