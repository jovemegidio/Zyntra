package br.com.aluforce.erp.presentation.financeiro

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
class FinanceiroViewModel @Inject constructor(
    private val getContasPagarUseCase: GetContasPagarUseCase,
    private val getContasReceberUseCase: GetContasReceberUseCase,
    private val registrarPagamentoUseCase: RegistrarPagamentoUseCase,
    private val registrarRecebimentoUseCase: RegistrarRecebimentoUseCase,
    private val getResumoFinanceiroUseCase: GetResumoFinanceiroUseCase,
    private val getFluxoCaixaUseCase: GetFluxoCaixaUseCase
) : ViewModel() {

    // Resumo
    private val _resumoState = MutableStateFlow<ResumoState>(ResumoState.Loading)
    val resumoState: StateFlow<ResumoState> = _resumoState.asStateFlow()

    // Contas a Pagar
    private val _contasPagarState = MutableStateFlow(ContasPagarListState())
    val contasPagarState: StateFlow<ContasPagarListState> = _contasPagarState.asStateFlow()

    // Contas a Receber
    private val _contasReceberState = MutableStateFlow(ContasReceberListState())
    val contasReceberState: StateFlow<ContasReceberListState> = _contasReceberState.asStateFlow()

    // Tab selection
    private val _selectedTab = MutableStateFlow(FinanceiroTab.RESUMO)
    val selectedTab: StateFlow<FinanceiroTab> = _selectedTab.asStateFlow()

    private val _events = MutableSharedFlow<FinanceiroEvent>()
    val events: SharedFlow<FinanceiroEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init { loadResumo() }

    fun selectTab(tab: FinanceiroTab) {
        _selectedTab.value = tab
        when (tab) {
            FinanceiroTab.RESUMO -> loadResumo()
            FinanceiroTab.PAGAR -> loadContasPagar()
            FinanceiroTab.RECEBER -> loadContasReceber()
        }
    }

    fun loadResumo() {
        viewModelScope.launch {
            _resumoState.value = ResumoState.Loading
            when (val result = getResumoFinanceiroUseCase()) {
                is Resource.Success -> _resumoState.value = ResumoState.Success(result.data)
                is Resource.Error -> _resumoState.value = ResumoState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }

    fun loadContasPagar(refresh: Boolean = false) {
        if (refresh) _contasPagarState.update { it.copy(currentPage = 1, contas = emptyList()) }
        viewModelScope.launch {
            _contasPagarState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _contasPagarState.value
            when (val result = getContasPagarUseCase(page = state.currentPage, status = state.statusFilter, search = state.searchQuery)) {
                is Resource.Success -> _contasPagarState.update {
                    it.copy(contas = if (refresh) result.data else it.contas + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _contasPagarState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadContasReceber(refresh: Boolean = false) {
        if (refresh) _contasReceberState.update { it.copy(currentPage = 1, contas = emptyList()) }
        viewModelScope.launch {
            _contasReceberState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _contasReceberState.value
            when (val result = getContasReceberUseCase(page = state.currentPage, status = state.statusFilter, search = state.searchQuery)) {
                is Resource.Success -> _contasReceberState.update {
                    it.copy(contas = if (refresh) result.data else it.contas + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _contasReceberState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun registrarPagamento(id: Int, valorPago: Double, dataPagamento: String, formaPagamento: String? = null) {
        viewModelScope.launch {
            when (val result = registrarPagamentoUseCase(id, valorPago, dataPagamento, formaPagamento)) {
                is Resource.Success -> {
                    _events.emit(FinanceiroEvent.Success("Pagamento registrado"))
                    loadContasPagar(refresh = true); loadResumo()
                }
                is Resource.Error -> _events.emit(FinanceiroEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    fun registrarRecebimento(id: Int, valorRecebido: Double, dataRecebimento: String, formaPagamento: String? = null) {
        viewModelScope.launch {
            when (val result = registrarRecebimentoUseCase(id, valorRecebido, dataRecebimento, formaPagamento)) {
                is Resource.Success -> {
                    _events.emit(FinanceiroEvent.Success("Recebimento registrado"))
                    loadContasReceber(refresh = true); loadResumo()
                }
                is Resource.Error -> _events.emit(FinanceiroEvent.Error(result.message))
                is Resource.Loading -> {}
            }
        }
    }

    fun searchPagar(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _contasPagarState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadContasPagar(refresh = true)
        }
    }

    fun searchReceber(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _contasReceberState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadContasReceber(refresh = true)
        }
    }

    fun filterPagarByStatus(status: String?) {
        _contasPagarState.update { it.copy(statusFilter = status) }; loadContasPagar(refresh = true)
    }

    fun filterReceberByStatus(status: String?) {
        _contasReceberState.update { it.copy(statusFilter = status) }; loadContasReceber(refresh = true)
    }

    fun refresh() {
        when (_selectedTab.value) {
            FinanceiroTab.RESUMO -> loadResumo()
            FinanceiroTab.PAGAR -> loadContasPagar(refresh = true)
            FinanceiroTab.RECEBER -> loadContasReceber(refresh = true)
        }
    }
}

enum class FinanceiroTab { RESUMO, PAGAR, RECEBER }

sealed class ResumoState {
    data object Loading : ResumoState()
    data class Success(val resumo: ResumoFinanceiro) : ResumoState()
    data class Error(val message: String) : ResumoState()
}

data class ContasPagarListState(
    val contas: List<ContaPagar> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val statusFilter: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = contas.isEmpty() && !isLoading }

data class ContasReceberListState(
    val contas: List<ContaReceber> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val statusFilter: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = contas.isEmpty() && !isLoading }

sealed class FinanceiroEvent {
    data class Success(val message: String) : FinanceiroEvent()
    data class Error(val message: String) : FinanceiroEvent()
}
