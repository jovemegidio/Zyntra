package br.com.aluforce.erp.presentation.nfe

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
class NFeViewModel @Inject constructor(
    private val getNotasFiscaisUseCase: GetNotasFiscaisUseCase,
    private val getNotaFiscalDetalheUseCase: GetNotaFiscalDetalheUseCase,
    private val emitirNFeUseCase: EmitirNFeUseCase,
    private val cancelarNFeUseCase: CancelarNFeUseCase,
    private val getDanfeUrlUseCase: GetDanfeUrlUseCase
) : ViewModel() {

    private val _listState = MutableStateFlow(NFeListState())
    val listState: StateFlow<NFeListState> = _listState.asStateFlow()

    private val _detailState = MutableStateFlow<NFeDetailState>(NFeDetailState.Idle)
    val detailState: StateFlow<NFeDetailState> = _detailState.asStateFlow()

    private val _events = MutableSharedFlow<NFeEvent>()
    val events: SharedFlow<NFeEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init { loadNotasFiscais() }

    fun loadNotasFiscais(refresh: Boolean = false) {
        if (refresh) _listState.update { it.copy(currentPage = 1, notas = emptyList()) }
        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _listState.value
            when (val result = getNotasFiscaisUseCase(page = state.currentPage, status = state.statusFilter, search = state.searchQuery)) {
                is Resource.Success -> _listState.update {
                    it.copy(notas = if (refresh) result.data else it.notas + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _listState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadNextPage() {
        val s = _listState.value; if (s.isLoading || !s.hasMore) return
        _listState.update { it.copy(currentPage = it.currentPage + 1) }; loadNotasFiscais()
    }

    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _listState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadNotasFiscais(refresh = true)
        }
    }

    fun filterByStatus(status: String?) {
        _listState.update { it.copy(statusFilter = status) }; loadNotasFiscais(refresh = true)
    }

    fun refresh() = loadNotasFiscais(refresh = true)

    fun loadNotaFiscalDetail(id: Int) {
        viewModelScope.launch {
            _detailState.value = NFeDetailState.Loading
            when (val result = getNotaFiscalDetalheUseCase(id)) {
                is Resource.Success -> _detailState.value = NFeDetailState.Success(result.data)
                is Resource.Error -> _detailState.value = NFeDetailState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }

    fun emitirNFe(pedidoId: Int, naturezaOperacao: String? = null, observacoes: String? = null) {
        viewModelScope.launch {
            when (val result = emitirNFeUseCase(pedidoId, naturezaOperacao, observacoes)) {
                is Resource.Success -> {
                    _detailState.value = NFeDetailState.Success(result.data)
                    _events.emit(NFeEvent.NFeEmitida("NFe emitida com sucesso"))
                    loadNotasFiscais(refresh = true)
                }
                is Resource.Error -> _events.emit(NFeEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    fun cancelarNFe(id: Int, motivo: String) {
        viewModelScope.launch {
            when (val result = cancelarNFeUseCase(id, motivo)) {
                is Resource.Success -> {
                    _detailState.value = NFeDetailState.Success(result.data)
                    _events.emit(NFeEvent.NFeCancelada("NFe cancelada"))
                    loadNotasFiscais(refresh = true)
                }
                is Resource.Error -> _events.emit(NFeEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    fun openDanfe(id: Int) {
        viewModelScope.launch {
            when (val result = getDanfeUrlUseCase(id)) {
                is Resource.Success -> _events.emit(NFeEvent.OpenUrl(result.data))
                is Resource.Error -> _events.emit(NFeEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }
}

data class NFeListState(
    val notas: List<NotaFiscal> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val statusFilter: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = notas.isEmpty() && !isLoading }

sealed class NFeDetailState {
    data object Idle : NFeDetailState()
    data object Loading : NFeDetailState()
    data class Success(val nota: NotaFiscal) : NFeDetailState()
    data class Error(val message: String) : NFeDetailState()
}

sealed class NFeEvent {
    data class NFeEmitida(val message: String) : NFeEvent()
    data class NFeCancelada(val message: String) : NFeEvent()
    data class OpenUrl(val url: String) : NFeEvent()
    data class Error(val message: String) : NFeEvent()
}
