package br.com.aluforce.erp.presentation.vendas

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.navigation.fragment.navArgs
import androidx.recyclerview.widget.LinearLayoutManager
import br.com.aluforce.erp.R
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.gone
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.toDisplayDate
import br.com.aluforce.erp.core.extensions.visible
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentPedidoDetailBinding
import br.com.aluforce.erp.domain.model.Pedido
import br.com.aluforce.erp.domain.model.PedidoStatus
import br.com.aluforce.erp.presentation.vendas.adapter.ItensAdapter
import br.com.aluforce.erp.presentation.vendas.adapter.HistoricoAdapter
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class PedidoDetailFragment : Fragment() {

    private var _binding: FragmentPedidoDetailBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PedidosViewModel by viewModels()
    private val args: PedidoDetailFragmentArgs by navArgs()

    private lateinit var itensAdapter: ItensAdapter
    private lateinit var historicoAdapter: HistoricoAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPedidoDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupToolbar()
        setupRecyclerViews()
        setupSwipeRefresh()
        observeState()
        viewModel.loadPedidoDetail(args.pedidoId)
    }

    private fun setupToolbar() {
        binding.toolbar.setNavigationOnClickListener {
            findNavController().navigateUp()
        }
    }

    private fun setupRecyclerViews() {
        itensAdapter = ItensAdapter()
        binding.rvItens.apply {
            adapter = itensAdapter
            layoutManager = LinearLayoutManager(requireContext())
        }

        historicoAdapter = HistoricoAdapter()
        binding.rvHistorico.apply {
            adapter = historicoAdapter
            layoutManager = LinearLayoutManager(requireContext())
        }
    }

    private fun setupSwipeRefresh() {
        binding.swipeRefresh.setColorSchemeResources(R.color.primary, R.color.secondary)
        binding.swipeRefresh.setOnRefreshListener {
            viewModel.loadPedidoDetail(args.pedidoId)
        }
    }

    private fun observeState() {
        collectFlow(viewModel.detailState) { state ->
            binding.swipeRefresh.isRefreshing = false

            when (state) {
                is PedidoDetailState.Loading -> {
                    binding.progressBar.visible()
                }
                is PedidoDetailState.Success -> {
                    binding.progressBar.gone()
                    renderPedido(state.pedido)
                }
                is PedidoDetailState.Error -> {
                    binding.progressBar.gone()
                    showSnackbar(state.message)
                }
                is PedidoDetailState.Idle -> {
                    binding.progressBar.gone()
                }
            }
        }
    }

    private fun renderPedido(pedido: Pedido) {
        binding.tvPedidoNumero.text = "#${pedido.numero}"
        binding.tvCliente.text = pedido.cliente.nome
        binding.tvVendedor.text = "Vendedor: ${pedido.vendedor ?: "-"}"
        binding.tvValorTotal.text = pedido.valorTotal.toBRL()
        binding.tvData.text = pedido.createdAt.toDisplayDate()

        // Status chip
        val status = pedido.status
        binding.chipStatus.text = status.displayName
        binding.chipStatus.setChipBackgroundColorResource(getStatusColorRes(status))
        binding.chipStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_on_primary))

        // Itens
        itensAdapter.submitList(pedido.itens)

        // Observações
        if (!pedido.observacoes.isNullOrBlank()) {
            binding.cardObservacoes.visible()
            binding.tvObservacoes.text = pedido.observacoes
        } else {
            binding.cardObservacoes.gone()
        }

        // Histórico
        historicoAdapter.submitList(pedido.historico)
    }

    private fun getStatusColorRes(status: PedidoStatus): Int {
        return when (status) {
            PedidoStatus.RASCUNHO -> R.color.status_rascunho
            PedidoStatus.PENDENTE -> R.color.status_pendente
            PedidoStatus.APROVADO -> R.color.status_aprovado
            PedidoStatus.EM_PRODUCAO -> R.color.status_producao
            PedidoStatus.FATURADO -> R.color.status_faturado
            PedidoStatus.ENTREGUE -> R.color.status_entregue
            PedidoStatus.CANCELADO -> R.color.status_cancelado
            else -> R.color.status_rascunho
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
