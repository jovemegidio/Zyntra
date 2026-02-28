package br.com.aluforce.erp.presentation.dashboard

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import br.com.aluforce.erp.R
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.gone
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.toCompact
import br.com.aluforce.erp.core.extensions.visible
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentDashboardBinding
import br.com.aluforce.erp.domain.model.DashboardKpis
import dagger.hilt.android.AndroidEntryPoint

/**
 * Dashboard fragment — Main screen after login.
 * Shows KPIs, notifications badge, and quick actions.
 */
@AndroidEntryPoint
class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!

    private val viewModel: DashboardViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupSwipeRefresh()
        setupPeriodChips()
        observeState()
    }

    private fun setupSwipeRefresh() {
        binding.swipeRefresh.setOnRefreshListener {
            viewModel.refreshDashboard()
        }
        binding.swipeRefresh.setColorSchemeResources(
            R.color.primary,
            R.color.secondary
        )
    }

    private fun setupPeriodChips() {
        binding.chipGroupPeriod.setOnCheckedStateChangeListener { _, checkedIds ->
            val period = when (checkedIds.firstOrNull()) {
                R.id.chipDay -> "day"
                R.id.chipWeek -> "week"
                R.id.chipMonth -> "month"
                R.id.chipYear -> "year"
                else -> "month"
            }
            viewModel.selectPeriod(period)
        }
    }

    private fun observeState() {
        collectFlow(viewModel.uiState) { state ->
            // Refresh indicator
            binding.swipeRefresh.isRefreshing = state.isRefreshing

            // Loading
            binding.progressBar.visibleIf(state.isLoadingKpis && !state.isRefreshing)

            // Error
            if (state.kpiError != null && !state.isLoadingKpis) {
                showSnackbar(state.kpiError)
            }

            // KPIs
            state.kpis?.let { renderKpis(it) }

            // Notifications badge
            binding.tvNotificationBadge.visibleIf(state.unreadCount > 0)
            binding.tvNotificationBadge.text = state.unreadCount.toString()
        }
    }

    private fun renderKpis(kpis: DashboardKpis) {
        binding.kpiContainer.visible()

        // Vendas KPIs
        kpis.vendas?.let { vendas ->
            binding.tvTotalPedidos.text = vendas.totalPedidos.toCompact()
            binding.tvValorVendas.text = vendas.valorTotal.toBRL()
            binding.tvTicketMedio.text = vendas.ticketMedio.toBRL()
            binding.tvPendentes.text = vendas.pedidosPendentes.toString()

            vendas.crescimento?.let { cresc ->
                binding.tvCrescimento.text = String.format("%+.1f%%", cresc)
                binding.tvCrescimento.setTextColor(
                    resources.getColor(
                        if (cresc >= 0) R.color.success else R.color.error,
                        null
                    )
                )
            }
        }

        // Financeiro KPIs
        kpis.financeiro?.let { fin ->
            binding.tvReceitas.text = fin.receitas.toBRL()
            binding.tvDespesas.text = fin.despesas.toBRL()
            binding.tvSaldo.text = fin.saldo.toBRL()
            binding.tvSaldo.setTextColor(
                resources.getColor(
                    if (fin.saldo >= 0) R.color.success else R.color.error,
                    null
                )
            )
        }

        // Produção KPIs
        kpis.producao?.let { prod ->
            binding.tvOrdensAtivas.text = prod.ordensAtivas.toString()
            binding.tvOrdensAtrasadas.text = prod.ordensAtrasadas.toString()
            prod.eficiencia?.let {
                binding.tvEficiencia.text = String.format("%.1f%%", it)
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
