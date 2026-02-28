package br.com.aluforce.erp.presentation.rh

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
class RHViewModel @Inject constructor(
    private val getFuncionariosUseCase: GetFuncionariosUseCase,
    private val getFuncionarioDetalheUseCase: GetFuncionarioDetalheUseCase,
    private val registrarPontoUseCase: RegistrarPontoUseCase,
    private val getPontoHojeUseCase: GetPontoHojeUseCase,
    private val getHoleritesUseCase: GetHoleritesUseCase,
    private val getDepartamentosUseCase: GetDepartamentosUseCase
) : ViewModel() {

    private val _listState = MutableStateFlow(FuncionariosListState())
    val listState: StateFlow<FuncionariosListState> = _listState.asStateFlow()

    private val _detailState = MutableStateFlow<FuncionarioDetailState>(FuncionarioDetailState.Idle)
    val detailState: StateFlow<FuncionarioDetailState> = _detailState.asStateFlow()

    private val _pontoState = MutableStateFlow<PontoState>(PontoState.Idle)
    val pontoState: StateFlow<PontoState> = _pontoState.asStateFlow()

    private val _departamentos = MutableStateFlow<List<String>>(emptyList())
    val departamentos: StateFlow<List<String>> = _departamentos.asStateFlow()

    private val _events = MutableSharedFlow<RHEvent>()
    val events: SharedFlow<RHEvent> = _events.asSharedFlow()

    private var searchJob: Job? = null

    init { loadFuncionarios(); loadDepartamentos() }

    fun loadFuncionarios(refresh: Boolean = false) {
        if (refresh) _listState.update { it.copy(currentPage = 1, funcionarios = emptyList()) }
        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, isRefreshing = refresh) }
            val state = _listState.value
            when (val result = getFuncionariosUseCase(page = state.currentPage, search = state.searchQuery, departamento = state.departamentoFilter)) {
                is Resource.Success -> _listState.update {
                    it.copy(funcionarios = if (refresh) result.data else it.funcionarios + result.data,
                        isLoading = false, isRefreshing = false, hasMore = result.data.size >= 20, error = null)
                }
                is Resource.Error -> _listState.update { it.copy(isLoading = false, isRefreshing = false, error = result.message) }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadNextPage() {
        val s = _listState.value; if (s.isLoading || !s.hasMore) return
        _listState.update { it.copy(currentPage = it.currentPage + 1) }; loadFuncionarios()
    }

    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            _listState.update { it.copy(searchQuery = query.takeIf { q -> q.isNotBlank() }) }
            loadFuncionarios(refresh = true)
        }
    }

    fun filterByDepartamento(departamento: String?) {
        _listState.update { it.copy(departamentoFilter = departamento) }; loadFuncionarios(refresh = true)
    }

    fun refresh() = loadFuncionarios(refresh = true)

    fun loadFuncionarioDetail(id: Int) {
        viewModelScope.launch {
            _detailState.value = FuncionarioDetailState.Loading
            when (val result = getFuncionarioDetalheUseCase(id)) {
                is Resource.Success -> _detailState.value = FuncionarioDetailState.Success(result.data)
                is Resource.Error -> _detailState.value = FuncionarioDetailState.Error(result.message)
                is Resource.Loading -> {}
            }
        }
    }

    fun registrarPonto(funcionarioId: Int, tipo: String) {
        viewModelScope.launch {
            _pontoState.value = PontoState.Loading
            when (val result = registrarPontoUseCase(funcionarioId, tipo)) {
                is Resource.Success -> {
                    _pontoState.value = PontoState.Success(result.data)
                    _events.emit(RHEvent.PontoRegistrado("Ponto registrado: $tipo"))
                }
                is Resource.Error -> {
                    _pontoState.value = PontoState.Error(result.message)
                    _events.emit(RHEvent.Error(result.message))
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun loadPontoHoje(funcionarioId: Int) {
        viewModelScope.launch {
            _pontoState.value = PontoState.Loading
            when (val result = getPontoHojeUseCase(funcionarioId)) {
                is Resource.Success -> _pontoState.value = PontoState.Success(result.data)
                is Resource.Error -> _pontoState.value = PontoState.Idle
                is Resource.Loading -> {}
            }
        }
    }

    private fun loadDepartamentos() {
        viewModelScope.launch {
            when (val result = getDepartamentosUseCase()) {
                is Resource.Success -> _departamentos.value = result.data
                else -> {}
            }
        }
    }
}

data class FuncionariosListState(
    val funcionarios: List<Funcionario> = emptyList(),
    val isLoading: Boolean = false, val isRefreshing: Boolean = false,
    val error: String? = null, val searchQuery: String? = null,
    val departamentoFilter: String? = null, val currentPage: Int = 1, val hasMore: Boolean = true
) { val isEmpty: Boolean get() = funcionarios.isEmpty() && !isLoading }

sealed class FuncionarioDetailState {
    data object Idle : FuncionarioDetailState()
    data object Loading : FuncionarioDetailState()
    data class Success(val funcionario: Funcionario) : FuncionarioDetailState()
    data class Error(val message: String) : FuncionarioDetailState()
}

sealed class PontoState {
    data object Idle : PontoState()
    data object Loading : PontoState()
    data class Success(val ponto: RegistroPonto) : PontoState()
    data class Error(val message: String) : PontoState()
}

sealed class RHEvent {
    data class PontoRegistrado(val message: String) : RHEvent()
    data class Error(val message: String) : RHEvent()
}
