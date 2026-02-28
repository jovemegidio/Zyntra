package br.com.aluforce.erp.presentation.compras

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
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentComprasListBinding
import br.com.aluforce.erp.presentation.compras.adapter.PedidosCompraAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class ComprasListFragment : Fragment() {

    private var _binding: FragmentComprasListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: ComprasViewModel by viewModels()
    private lateinit var adapter: PedidosCompraAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentComprasListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView(); setupSearch(); setupFilters(); setupSwipeRefresh(); observeState(); observeEvents()
    }

    private fun setupRecyclerView() {
        adapter = PedidosCompraAdapter { pedido ->
            val action = ComprasListFragmentDirections.actionComprasListToCompraDetail(pedido.id)
            findNavController().navigate(action)
        }
        binding.rvCompras.apply {
            this.adapter = this@ComprasListFragment.adapter
            layoutManager = LinearLayoutManager(requireContext())
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) {
                    val lm = rv.layoutManager as LinearLayoutManager
                    if (lm.childCount + lm.findFirstVisibleItemPosition() >= lm.itemCount - 5) viewModel.loadNextPage()
                }
            })
        }
    }

    private fun setupSearch() {
        binding.searchView.setOnQueryTextListener(object : SearchView.OnQueryTextListener {
            override fun onQueryTextSubmit(query: String?) = true.also { viewModel.search(query ?: "") }
            override fun onQueryTextChange(newText: String?) = true.also { viewModel.search(newText ?: "") }
        })
    }

    private fun setupFilters() {
        binding.chipGroupStatus.setOnCheckedStateChangeListener { _, checkedIds ->
            val status = when (checkedIds.firstOrNull()) {
                R.id.chipPendente -> "pendente"
                R.id.chipAprovado -> "aprovado"
                R.id.chipRecebido -> "recebido"
                else -> null
            }
            viewModel.filterByStatus(status)
        }
    }

    private fun setupSwipeRefresh() { binding.swipeRefresh.setOnRefreshListener { viewModel.refresh() } }

    private fun observeState() {
        collectFlow(viewModel.listState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            binding.progressBar.visibleIf(state.isLoading && !state.isRefreshing && state.pedidos.isEmpty())
            binding.emptyState.visibleIf(state.isEmpty)
            binding.rvCompras.visibleIf(!state.isEmpty)
            if (state.error != null && !state.isLoading) showSnackbar(state.error)
            adapter.submitList(state.pedidos)
        }
    }

    private fun observeEvents() {
        collectFlow(viewModel.events) { event ->
            when (event) {
                is CompraEvent.StatusUpdated -> showSnackbar(event.message)
                is CompraEvent.Error -> showSnackbar(event.message)
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
