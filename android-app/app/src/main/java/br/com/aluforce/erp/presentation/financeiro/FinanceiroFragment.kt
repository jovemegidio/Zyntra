package br.com.aluforce.erp.presentation.financeiro

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentFinanceiroBinding
import br.com.aluforce.erp.domain.model.ResumoFinanceiro
import br.com.aluforce.erp.presentation.financeiro.adapter.ContasPagarAdapter
import br.com.aluforce.erp.presentation.financeiro.adapter.ContasReceberAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class FinanceiroFragment : Fragment() {

    private var _binding: FragmentFinanceiroBinding? = null
    private val binding get() = _binding!!
    private val viewModel: FinanceiroViewModel by viewModels()
    private lateinit var contasPagarAdapter: ContasPagarAdapter
    private lateinit var contasReceberAdapter: ContasReceberAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentFinanceiroBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupAdapters(); setupTabs(); setupSwipeRefresh(); observeState()
    }

    private fun setupAdapters() {
        contasPagarAdapter = ContasPagarAdapter { /* detail click */ }
        contasReceberAdapter = ContasReceberAdapter { /* detail click */ }
        binding.rvContasPagar.apply { adapter = contasPagarAdapter; layoutManager = LinearLayoutManager(requireContext()) }
        binding.rvContasReceber.apply { adapter = contasReceberAdapter; layoutManager = LinearLayoutManager(requireContext()) }
    }

    private fun setupTabs() {
        binding.tabLayout.addOnTabSelectedListener(object : com.google.android.material.tabs.TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: com.google.android.material.tabs.TabLayout.Tab?) {
                val finTab = when (tab?.position) {
                    0 -> FinanceiroTab.RESUMO
                    1 -> FinanceiroTab.PAGAR
                    2 -> FinanceiroTab.RECEBER
                    else -> FinanceiroTab.RESUMO
                }
                viewModel.selectTab(finTab)
            }
            override fun onTabUnselected(tab: com.google.android.material.tabs.TabLayout.Tab?) {}
            override fun onTabReselected(tab: com.google.android.material.tabs.TabLayout.Tab?) {}
        })
    }

    private fun setupSwipeRefresh() { binding.swipeRefresh.setOnRefreshListener { viewModel.refresh() } }

    private fun observeState() {
        collectFlow(viewModel.selectedTab) { tab ->
            binding.resumoLayout.visibleIf(tab == FinanceiroTab.RESUMO)
            binding.rvContasPagar.visibleIf(tab == FinanceiroTab.PAGAR)
            binding.rvContasReceber.visibleIf(tab == FinanceiroTab.RECEBER)
        }

        collectFlow(viewModel.resumoState) { state ->
            binding.progressBar.visibleIf(state is ResumoState.Loading)
            when (state) {
                is ResumoState.Success -> bindResumo(state.resumo)
                is ResumoState.Error -> showSnackbar(state.message)
                else -> {}
            }
        }

        collectFlow(viewModel.contasPagarState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            contasPagarAdapter.submitList(state.contas)
        }

        collectFlow(viewModel.contasReceberState) { state ->
            binding.swipeRefresh.isRefreshing = state.isRefreshing
            contasReceberAdapter.submitList(state.contas)
        }

        collectFlow(viewModel.events) { event ->
            when (event) {
                is FinanceiroEvent.Success -> showSnackbar(event.message)
                is FinanceiroEvent.Error -> showSnackbar(event.message)
            }
        }
    }

    private fun bindResumo(resumo: ResumoFinanceiro) {
        binding.tvReceitas.text = resumo.totalReceitas.toBRL()
        binding.tvDespesas.text = resumo.totalDespesas.toBRL()
        binding.tvSaldo.text = resumo.saldo.toBRL()
        binding.tvPagarVencidas.text = resumo.contasPagarVencidas.toString()
        binding.tvReceberVencidas.text = resumo.contasReceberVencidas.toString()
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
