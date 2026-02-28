package br.com.aluforce.erp.presentation.compras

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*
import br.com.aluforce.erp.domain.usecase.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ComprasViewModel @Inject constructor(
    private val getPedidosCompraUseCase: GetPedidosCompraUseCase,
    private val getPedidoCompraDetalheUseCase: GetPedidoCompraDetalheUseCase,
    private val updateCompraStatusUseCase: UpdateCompraStatusUseCase,
    private val getFornecedoresUseCase: GetFornecedoresUseCase
) : ViewModel() {

    private val _listState = MutableStateFlow(ComprasListState())
    val listState: StateFlow<ComprasListState> = _listState.asStateFlow()

    private val _detailState = MutableStateFlow<CompraDetailState>(CompraDetailState.Idle)
    val detailState: StateFlow<CompraDetailState> = _detailState.asStateFlow()

    private val _fornecedoresState = MutableStateFlow(FornecedoresListState())
    val fornecedoresState: StateFlow<FornecedoresListState> = _fornecedoresState.asStateFlow()

    private val _events = MutableSharedFlow<CompraEvent>()
    val events: SharedFlow<CompraEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init { loadPedidosCompra() }

    fun loadPedidosCompra(refresh: Boolean = false) {
        if (refresh) _listState.update { it.copy(currentPage = 1, pedidos = emptyList()) }
        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _listState.value
            when (val result = getPedidosCompraUseCase(page = state.currentPage, search = state.searchQuery, status = state.statusFilter)) {
                is Resource.Success -> _listState.update {
                    it.copy(pedidos = if (refresh) result.data else it.pedidos + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _listState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadNextPage() {
        val s = _listState.value; if (s.isLoading || !s.hasMore) return
        _listState.update { it.copy(currentPage = it.currentPage + 1) }; loadPedidosCompra()
    }

    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _listState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadPedidosCompra(refresh = true)
        }
    }

    fun filterByStatus(status: String?) {
        _listState.update { it.copy(statusFilter = status) }; loadPedidosCompra(refresh = true)
    }

    fun refresh() = loadPedidosCompra(refresh = true)

    fun loadPedidoCompraDetail(id: Int) {
        viewModelScope.launch {
            _detailState.value = CompraDetailState.Loading
            when (val result = getPedidoCompraDetalheUseCase(id)) {
                is Resource.Success -> _detailState.value = CompraDetailState.Success(result.data)
                is Resource.Error -> _detailState.value = CompraDetailState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }

    fun updateStatus(pedidoId: Int, newStatus: String, observacao: String? = null) {
        viewModelScope.launch {
            _detailState.value = CompraDetailState.Loading
            when (val result = updateCompraStatusUseCase(pedidoId, newStatus, observacao)) {
                is Resource.Success -> {
                    _detailState.value = CompraDetailState.Success(result.data)
                    _events.emit(CompraEvent.StatusUpdated("Status atualizado"))
                    loadPedidosCompra(refresh = true)
                }
                is Resource.Error -> _events.emit(CompraEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    fun loadFornecedores(refresh: Boolean = false) {
        if (refresh) _fornecedoresState.update { it.copy(currentPage = 1, fornecedores = emptyList()) }
        viewModelScope.launch {
            _fornecedoresState.update { it.copy(isLoading = true) }
            val state = _fornecedoresState.value
            when (val result = getFornecedoresUseCase(page = state.currentPage, search = state.searchQuery)) {
                is Resource.Success -> _fornecedoresState.update {
                    it.copy(fornecedores = if (refresh) result.data else it.fornecedores + result.data,
                        isLoading = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _fornecedoresState.update { it.copy(isLoading = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }
}

data class ComprasListState(
    val pedidos: List<PedidoCompraResumo> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val statusFilter: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = pedidos.isEmpty() && !isLoading }

data class FornecedoresListState(
    val fornecedores: List<Fornecedor> = emptyList(),
    val isLoading: Boolean = false, val error: String? = null,
    val searchQuery: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
)

sealed class CompraDetailState {
    data object Idle : CompraDetailState()
    data object Loading : CompraDetailState()
    data class Success(val pedido: PedidoCompra) : CompraDetailState()
    data class Error(val message: String) : CompraDetailState()
}

sealed class CompraEvent {
    data class StatusUpdated(val message: String) : CompraEvent()
    data class Error(val message: String) : CompraEvent()
}
