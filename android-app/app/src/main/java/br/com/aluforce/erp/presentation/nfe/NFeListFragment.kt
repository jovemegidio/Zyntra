package br.com.aluforce.erp.presentation.nfe

import android.content.Intent
import android.net.Uri
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
import br.com.aluforce.erp.databinding.FragmentNfeListBinding
import br.com.aluforce.erp.presentation.nfe.adapter.NotasFiscaisAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class NFeListFragment : Fragment() {

    private var _binding: FragmentNfeListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: NFeViewModel by viewModels()
    private lateinit var adapter: NotasFiscaisAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentNfeListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView(); setupSearch(); setupFilters(); setupSwipeRefresh(); observeState(); observeEvents()
    }

    private fun setupRecyclerView() {
        adapter = NotasFiscaisAdapter { nfe ->
            val action = NFeListFragmentDirections.actionNfeListToNfeDetail(nfe.id)
            findNavController().navigate(action)
        }
        binding.rvNotas.apply {
            this.adapter = this@NFeListFragment.adapter
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
                R.id.chipAutorizada -> "autorizada"
                R.id.chipCancelada -> "cancelada"
                R.id.chipPendente -> "pendente"
                else -> null
            }
            viewModel.filterByStatus(status)
        }
    }

    private fun setupSwipeRefresh() { binding.swipeRefresh.setOnRefreshListener { viewModel.refresh() } }

    private fun observeState() {
        collectFlow(viewModel.listState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            binding.progressBar.visibleIf(state.isLoading && !state.isRefreshing && state.notas.isEmpty())
            binding.emptyState.visibleIf(state.isEmpty)
            binding.rvNotas.visibleIf(!state.isEmpty)
            if (state.error != null && !state.isLoading) showSnackbar(state.error)
            adapter.submitList(state.notas)
        }
    }

    private fun observeEvents() {
        collectFlow(viewModel.events) { event ->
            when (event) {
                is NFeEvent.NFeEmitida -> showSnackbar(event.message)
                is NFeEvent.NFeCancelada -> showSnackbar(event.message)
                is NFeEvent.OpenUrl -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(event.url)))
                is NFeEvent.Error -> showSnackbar(event.message)
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
