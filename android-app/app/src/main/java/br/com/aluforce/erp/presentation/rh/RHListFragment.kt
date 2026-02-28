package br.com.aluforce.erp.presentation.rh

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
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentRhListBinding
import br.com.aluforce.erp.presentation.rh.adapter.FuncionariosAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class RHListFragment : Fragment() {

    private var _binding: FragmentRhListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: RHViewModel by viewModels()
    private lateinit var adapter: FuncionariosAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentRhListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView(); setupSearch(); setupSwipeRefresh(); observeState(); observeEvents()
    }

    private fun setupRecyclerView() {
        adapter = FuncionariosAdapter { func ->
            val action = RHListFragmentDirections.actionRhListToFuncionarioDetail(func.id)
            findNavController().navigate(action)
        }
        binding.rvFuncionarios.apply {
            this.adapter = this@RHListFragment.adapter
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
            binding.progressBar.visibleIf(state.isLoading && !state.isRefreshing && state.funcionarios.isEmpty())
            binding.emptyState.visibleIf(state.isEmpty)
            binding.rvFuncionarios.visibleIf(!state.isEmpty)
            if (state.error != null && !state.isLoading) showSnackbar(state.error)
            adapter.submitList(state.funcionarios)
        }
    }

    private fun observeEvents() {
        collectFlow(viewModel.events) { event ->
            when (event) {
                is RHEvent.PontoRegistrado -> showSnackbar(event.message)
                is RHEvent.Error -> showSnackbar(event.message)
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
