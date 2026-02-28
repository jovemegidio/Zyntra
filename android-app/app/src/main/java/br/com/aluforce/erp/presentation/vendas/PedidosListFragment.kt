package br.com.aluforce.erp.presentation.vendas

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.widget.SearchView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.R
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.gone
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.visible
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentPedidosListBinding
import br.com.aluforce.erp.presentation.vendas.adapter.PedidosAdapter
import dagger.hilt.android.AndroidEntryPoint

/**
 * Fragment for listing orders (Pedidos).
 * Features: search, status filter, pagination, pull-to-refresh.
 */
@AndroidEntryPoint
class PedidosListFragment : Fragment() {

    private var _binding: FragmentPedidosListBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PedidosViewModel by viewModels()
    private lateinit var pedidosAdapter: PedidosAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPedidosListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupRecyclerView()
        setupSearch()
        setupFilters()
        setupSwipeRefresh()
        observeState()
        observeEvents()
    }

    private fun setupRecyclerView() {
        pedidosAdapter = PedidosAdapter { pedido ->
            // Navigate to detail
            val action = PedidosListFragmentDirections
                .actionPedidosListToPedidoDetail(pedido.id)
            findNavController().navigate(action)
        }

        binding.rvPedidos.apply {
            adapter = pedidosAdapter
            layoutManager = LinearLayoutManager(requireContext())

            // Infinite scroll
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                    super.onScrolled(recyclerView, dx, dy)
                    val layoutManager = recyclerView.layoutManager as LinearLayoutManager
                    val visibleItemCount = layoutManager.childCount
                    val totalItemCount = layoutManager.itemCount
                    val firstVisibleItemPosition = layoutManager.findFirstVisibleItemPosition()

                    if (visibleItemCount + firstVisibleItemPosition >= totalItemCount - 5) {
                        viewModel.loadNextPage()
                    }
                }
            })
        }
    }

    private fun setupSearch() {
        binding.searchView.setOnQueryTextListener(object : SearchView.OnQueryTextListener {
            override fun onQueryTextSubmit(query: String?): Boolean {
                viewModel.search(query ?: "")
                return true
            }

            override fun onQueryTextChange(newText: String?): Boolean {
                viewModel.search(newText ?: "")
                return true
            }
        })
    }

    private fun setupFilters() {
        binding.chipGroupStatus.setOnCheckedStateChangeListener { _, checkedIds ->
            val status = when (checkedIds.firstOrNull()) {
                R.id.chipPendente -> "pendente"
                R.id.chipAprovado -> "aprovado"
                R.id.chipProducao -> "em_producao"
                R.id.chipFaturado -> "faturado"
                R.id.chipEntregue -> "entregue"
                else -> null // All
            }
            viewModel.filterByStatus(status)
        }
    }

    private fun setupSwipeRefresh() {
        binding.swipeRefresh.setOnRefreshListener {
            viewModel.refresh()
        }
    }

    private fun observeState() {
        collectFlow(viewModel.listState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            binding.progressBar.visibleIf(state.isLoading && !state.isRefreshing && state.pedidos.isEmpty())

            // Empty state
            binding.emptyState.visibleIf(state.isEmpty)
            binding.rvPedidos.visibleIf(!state.isEmpty)

            // Error
            if (state.error != null && !state.isLoading) {
                showSnackbar(state.error)
            }

            // Update adapter
            pedidosAdapter.submitList(state.pedidos)
        }
    }

    private fun observeEvents() {
        collectFlow(viewModel.events) { event ->
            when (event) {
                is PedidoEvent.StatusUpdated -> showSnackbar(event.message)
                is PedidoEvent.Error -> showSnackbar(event.message)
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
