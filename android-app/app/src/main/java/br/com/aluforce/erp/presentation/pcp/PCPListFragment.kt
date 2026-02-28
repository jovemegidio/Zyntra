package br.com.aluforce.erp.presentation.pcp

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
import br.com.aluforce.erp.databinding.FragmentPcpListBinding
import br.com.aluforce.erp.presentation.pcp.adapter.OrdensProducaoAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class PCPListFragment : Fragment() {

    private var _binding: FragmentPcpListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: PCPViewModel by viewModels()
    private lateinit var adapter: OrdensProducaoAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentPcpListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView(); setupSearch(); setupFilters(); setupSwipeRefresh(); observeState(); observeEvents()
    }

    private fun setupRecyclerView() {
        adapter = OrdensProducaoAdapter { ordem ->
            val action = PCPListFragmentDirections.actionPcpListToOrdemDetail(ordem.id)
            findNavController().navigate(action)
        }
        binding.rvOrdens.apply {
            this.adapter = this@PCPListFragment.adapter
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
                R.id.chipPlanejada -> "planejada"
                R.id.chipEmProducao -> "em_producao"
                R.id.chipConcluida -> "concluida"
                else -> null
            }
            viewModel.filterByStatus(status)
        }
    }

    private fun setupSwipeRefresh() { binding.swipeRefresh.setOnRefreshListener { viewModel.refresh() } }

    private fun observeState() {
        collectFlow(viewModel.listState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            binding.progressBar.visibleIf(state.isLoading && !state.isRefreshing && state.ordens.isEmpty())
            binding.emptyState.visibleIf(state.isEmpty)
            binding.rvOrdens.visibleIf(!state.isEmpty)
            if (state.error != null && !state.isLoading) showSnackbar(state.error)
            adapter.submitList(state.ordens)
        }
    }

    private fun observeEvents() {
        collectFlow(viewModel.events) { event ->
            when (event) {
                is PCPEvent.StatusUpdated -> showSnackbar(event.message)
                is PCPEvent.ApontamentoCreated -> showSnackbar(event.message)
                is PCPEvent.Error -> showSnackbar(event.message)
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
