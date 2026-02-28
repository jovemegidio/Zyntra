package br.com.aluforce.erp.presentation.clientes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.Cliente
import br.com.aluforce.erp.domain.model.ClienteHistorico
import br.com.aluforce.erp.domain.model.PedidoResumo
import br.com.aluforce.erp.domain.usecase.GetClienteDetalheUseCase
import br.com.aluforce.erp.domain.usecase.GetClienteHistoricoUseCase
import br.com.aluforce.erp.domain.usecase.GetClientePedidosUseCase
import br.com.aluforce.erp.domain.usecase.GetClientesUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ClientesViewModel @Inject constructor(
    private val getClientesUseCase: GetClientesUseCase,
    private val getClienteDetalheUseCase: GetClienteDetalheUseCase,
    private val getClientePedidosUseCase: GetClientePedidosUseCase,
    private val getClienteHistoricoUseCase: GetClienteHistoricoUseCase
) : ViewModel() {

    private val _listState = MutableStateFlow(ClientesListState())
    val listState: StateFlow<ClientesListState> = _listState.asStateFlow()

    private val _detailState = MutableStateFlow<ClienteDetailState>(ClienteDetailState.Idle)
    val detailState: StateFlow<ClienteDetailState> = _detailState.asStateFlow()

    private val _events = MutableSharedFlow<ClienteEvent>()
    val events: SharedFlow<ClienteEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init { loadClientes() }

    fun loadClientes(refresh: Boolean = false) {
        if (refresh) _listState.update { it.copy(currentPage = 1, clientes = emptyList()) }
        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _listState.value
            when (val result = getClientesUseCase(page = state.currentPage, search = state.searchQuery)) {
                is Resource.Success -> _listState.update {
                    it.copy(clientes = if (refresh) result.data else it.clientes + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _listState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadNextPage() {
        val s = _listState.value; if (s.isLoading || !s.hasMore) return
        _listState.update { it.copy(currentPage = it.currentPage + 1) }; loadClientes()
    }

    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _listState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadClientes(refresh = true)
        }
    }

    fun refresh() = loadClientes(refresh = true)

    fun loadClienteDetail(id: Int) {
        viewModelScope.launch {
            _detailState.value = ClienteDetailState.Loading
            when (val result = getClienteDetalheUseCase(id)) {
                is Resource.Success -> {
                    _detailState.value = ClienteDetailState.Success(result.data)
                    loadClientePedidos(id)
                }
                is Resource.Error -> _detailState.value = ClienteDetailState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }

    private fun loadClientePedidos(clienteId: Int) {
        viewModelScope.launch {
            when (val result = getClientePedidosUseCase(clienteId)) {
                is Resource.Success -> {
                    val current = (_detailState.value as? ClienteDetailState.Success) ?: return@launch
                    _detailState.value = current.copy(pedidos = result.data)
                }
                else -> {}
            }
        }
    }
}

data class ClientesListState(
    val clientes: List<Cliente> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = clientes.isEmpty() && !isLoading }

sealed class ClienteDetailState {
    data object Idle : ClienteDetailState()
    data object Loading : ClienteDetailState()
    data class Success(val cliente: Cliente, val pedidos: List<PedidoResumo> = emptyList(), val historico: List<ClienteHistorico> = emptyList()) : ClienteDetailState()
    data class Error(val message: String) : ClienteDetailState()
}

sealed class ClienteEvent {
    data class ShowMessage(val message: String) : ClienteEvent()
    data class Error(val message: String) : ClienteEvent()
}
