package br.com.aluforce.erp.presentation.pcp

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
import br.com.aluforce.erp.databinding.FragmentOrdemDetailBinding
import br.com.aluforce.erp.domain.model.OrdemProducao
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale

@AndroidEntryPoint
class OrdemDetailFragment : Fragment() {

    private var _binding: FragmentOrdemDetailBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PCPViewModel by viewModels()
    private val args: OrdemDetailFragmentArgs by navArgs()

    private val inputFmt  = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.getDefault())
    private val inputFmt2 = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val outputFmt = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentOrdemDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.btnRetry.setOnClickListener { viewModel.loadOrdemDetail(args.ordemId) }
        binding.swipeRefresh.setOnRefreshListener { viewModel.loadOrdemDetail(args.ordemId) }

        viewModel.loadOrdemDetail(args.ordemId)
        observeState()
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.detailState.collectLatest { state ->
                binding.swipeRefresh.isRefreshing = false
                when (state) {
                    is OrdemDetailState.Loading -> {
                        binding.loadingOverlay.isVisible = true
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = false
                    }
                    is OrdemDetailState.Success -> {
                        binding.loadingOverlay.isVisible = false
                        binding.errorView.isVisible      = false
                        binding.scrollContent.isVisible  = true
                        bindOrdem(state.ordem)
                    }
                    is OrdemDetailState.Error -> {
                        binding.loadingOverlay.isVisible = false
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = true
                        binding.tvError.text             = state.message
                    }
                    is OrdemDetailState.Idle -> Unit
                }
            }
        }
    }

    private fun bindOrdem(o: OrdemProducao) {
        binding.tvNumero.text      = o.numero.ifBlank { "OP #${o.id}" }
        binding.tvProduto.text     = o.produto
        binding.tvResponsavel.text = if (!o.responsavel.isNullOrBlank()) "Responsável: ${o.responsavel}" else ""

        val statusColor = parseColor(o.status.color)
        binding.chipStatus.text            = o.status.displayName
        binding.chipStatus.chipBackgroundColor =
            android.content.res.ColorStateList.valueOf(statusColor and 0x30FFFFFF or 0x20000000)
        binding.chipStatus.setTextColor(statusColor)

        val progresso = o.progresso.coerceIn(0.0, 100.0).toInt()
        binding.progressBar.progress = progresso
        binding.tvProgressoPct.text  = "$progresso%"

        val unidade = o.unidade.ifBlank { "un" }
        binding.tvQtdSolicitada.text = "${o.quantidade.formatQtd()} $unidade"
        binding.tvQtdProduzida.text  = "${o.quantidadeProduzida.formatQtd()} $unidade"
        binding.tvPrioridade.text    = o.prioridade ?: "Normal"

        binding.tvDataInicio.text    = fmtDate(o.dataInicio)
        binding.tvDataPrevisao.text  = fmtDate(o.dataPrevisao)
        binding.tvDataConclusao.text = fmtDate(o.dataConclusao)

        if (!o.observacoes.isNullOrBlank()) {
            binding.cardObservacoes.isVisible = true
            binding.tvObservacoes.text        = o.observacoes
        }

        if (o.etapas.isNotEmpty()) {
            binding.tvEtapasLabel.isVisible = true
            binding.rvEtapas.isVisible      = true
        }

        if (o.apontamentos.isNotEmpty()) {
            binding.tvApontamentosLabel.isVisible = true
            binding.rvApontamentos.isVisible      = true
        }
    }

    private fun fmtDate(iso: String?): String {
        if (iso.isNullOrBlank()) return "—"
        return runCatching { outputFmt.format(inputFmt.parse(iso)!!) }
            .recover { outputFmt.format(inputFmt2.parse(iso)!!) }
            .getOrDefault(iso)
    }

    private fun Double.formatQtd(): String =
        if (this == kotlin.math.floor(this)) toLong().toString()
        else "%.1f".format(this)

    private fun parseColor(hex: String): Int = runCatching { Color.parseColor(hex) }.getOrDefault(Color.GRAY)

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
