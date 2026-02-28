package br.com.aluforce.erp.presentation.clientes

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
import br.com.aluforce.erp.databinding.FragmentClientesListBinding
import br.com.aluforce.erp.presentation.clientes.adapter.ClientesAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class ClientesListFragment : Fragment() {

    private var _binding: FragmentClientesListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: ClientesViewModel by viewModels()
    private lateinit var adapter: ClientesAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentClientesListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView(); setupSearch(); setupSwipeRefresh(); observeState()
    }

    private fun setupRecyclerView() {
        adapter = ClientesAdapter { cliente ->
            val action = ClientesListFragmentDirections.actionClientesListToClienteDetail(cliente.id)
            findNavController().navigate(action)
        }
        binding.rvClientes.apply {
            this.adapter = this@ClientesListFragment.adapter
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

    private fun setupSwipeRefresh() { binding.swipeRefresh.setOnRefreshListener { viewModel.refresh() } }

    private fun observeState() {
        collectFlow(viewModel.listState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            binding.progressBar.visibleIf(state.isLoading && !state.isRefreshing && state.clientes.isEmpty())
            binding.emptyState.visibleIf(state.isEmpty)
            binding.rvClientes.visibleIf(!state.isEmpty)
            if (state.error != null && !state.isLoading) showSnackbar(state.error)
            adapter.submitList(state.clientes)
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
