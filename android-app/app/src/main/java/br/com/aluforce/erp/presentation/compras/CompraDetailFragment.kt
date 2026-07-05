package br.com.aluforce.erp.presentation.compras

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.navigation.fragment.navArgs
import br.com.aluforce.erp.databinding.FragmentCompraDetailBinding
import br.com.aluforce.erp.domain.model.PedidoCompra
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale

@AndroidEntryPoint
class CompraDetailFragment : Fragment() {

    private var _binding: FragmentCompraDetailBinding? = null
    private val binding get() = _binding!!

    private val viewModel: ComprasViewModel by viewModels()
    private val args: CompraDetailFragmentArgs by navArgs()

    private val currFmt   = NumberFormat.getCurrencyInstance(Locale("pt", "BR"))
    private val inputFmt  = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.getDefault())
    private val inputFmt2 = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val outputFmt = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentCompraDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.btnRetry.setOnClickListener { viewModel.loadPedidoCompraDetail(args.compraId) }
        binding.swipeRefresh.setOnRefreshListener { viewModel.loadPedidoCompraDetail(args.compraId) }

        viewModel.loadPedidoCompraDetail(args.compraId)
        observeState()
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.detailState.collectLatest { state ->
                binding.swipeRefresh.isRefreshing = false
                when (state) {
                    is CompraDetailState.Loading -> {
                        binding.loadingOverlay.isVisible = true
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = false
                    }
                    is CompraDetailState.Success -> {
                        binding.loadingOverlay.isVisible = false
                        binding.errorView.isVisible      = false
                        binding.scrollContent.isVisible  = true
                        bindPedido(state.pedido)
                    }
                    is CompraDetailState.Error -> {
                        binding.loadingOverlay.isVisible = false
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = true
                        binding.tvError.text             = state.message
                    }
                    is CompraDetailState.Idle -> Unit
                }
            }
        }
    }

    private fun bindPedido(p: PedidoCompra) {
        val pcLabel = if (p.numero.isNotBlank()) "PC-${p.numero}" else "PC #${p.id}"
        binding.toolbar.title    = pcLabel
        binding.tvNumeroPc.text  = pcLabel
        binding.tvFornecedor.text = p.fornecedor.nome
        binding.tvComprador.text  = if (!p.comprador.isNullOrBlank()) "Comprador: ${p.comprador}" else ""

        val (statusLabel, statusColorHex) = when (p.status.name.lowercase()) {
            "aprovado"         -> "Aprovado"  to "#4CAF50"
            "recebido"         -> "Recebido"  to "#00BCD4"
            "recebido_parcial" -> "Parcial"   to "#673AB7"
            "cancelado"        -> "Cancelado" to "#F44336"
            "enviado"          -> "Enviado"   to "#2196F3"
            else               -> p.status.displayName to "#FF9800"
        }
        binding.chipStatus.text = statusLabel
        runCatching {
            val color = Color.parseColor(statusColorHex)
            binding.chipStatus.chipBackgroundColor =
                android.content.res.ColorStateList.valueOf(color and 0x30FFFFFF or 0x20000000)
            binding.chipStatus.setTextColor(color)
        }

        binding.tvValorTotal.text  = currFmt.format(p.valorTotal)
        binding.tvDataPedido.text  = fmtDate(p.dataPedido)
        binding.tvPrazoEntrega.text = fmtDate(p.prazoEntrega)

        if (p.itens.isNotEmpty()) {
            binding.tvItensLabel.isVisible = true
            binding.rvItens.isVisible      = true
        }

        if (!p.condicaoPagamento.isNullOrBlank()) {
            binding.cardPagamento.isVisible      = true
            binding.tvCondicaoPagamento.text     = p.condicaoPagamento
        }

        if (!p.observacoes.isNullOrBlank()) {
            binding.cardObservacoes.isVisible = true
            binding.tvObservacoes.text        = p.observacoes
        }
    }

    private fun fmtDate(iso: String?): String {
        if (iso.isNullOrBlank()) return "—"
        return runCatching { outputFmt.format(inputFmt.parse(iso)!!) }
            .recover { outputFmt.format(inputFmt2.parse(iso)!!) }
            .getOrDefault(iso)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
