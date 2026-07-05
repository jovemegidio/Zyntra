package br.com.aluforce.erp.presentation.nfe

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.navigation.fragment.navArgs
import br.com.aluforce.erp.databinding.FragmentNfeDetailBinding
import br.com.aluforce.erp.domain.model.NotaFiscal
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale

@AndroidEntryPoint
class NFeDetailFragment : Fragment() {

    private var _binding: FragmentNfeDetailBinding? = null
    private val binding get() = _binding!!

    private val viewModel: NFeViewModel by viewModels()
    private val args: NFeDetailFragmentArgs by navArgs()

    private val currFmt   = NumberFormat.getCurrencyInstance(Locale("pt", "BR"))
    private val inputFmt  = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.getDefault())
    private val inputFmt2 = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val outputFmt = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentNfeDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.btnRetry.setOnClickListener { viewModel.loadNotaFiscalDetail(args.nfeId) }
        binding.swipeRefresh.setOnRefreshListener { viewModel.loadNotaFiscalDetail(args.nfeId) }

        viewModel.loadNotaFiscalDetail(args.nfeId)
        observeState()
        observeEvents()
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.detailState.collectLatest { state ->
                binding.swipeRefresh.isRefreshing = false
                when (state) {
                    is NFeDetailState.Loading -> {
                        binding.loadingOverlay.isVisible = true
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = false
                    }
                    is NFeDetailState.Success -> {
                        binding.loadingOverlay.isVisible = false
                        binding.errorView.isVisible      = false
                        binding.scrollContent.isVisible  = true
                        bindNota(state.nota)
                    }
                    is NFeDetailState.Error -> {
                        binding.loadingOverlay.isVisible = false
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = true
                        binding.tvError.text             = state.message
                    }
                    is NFeDetailState.Idle -> Unit
                }
            }
        }
    }

    private fun observeEvents() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.events.collectLatest { event ->
                when (event) {
                    is NFeEvent.OpenUrl -> {
                        runCatching {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(event.url)))
                        }.onFailure {
                            Toast.makeText(requireContext(), "Não foi possível abrir o DANFE", Toast.LENGTH_SHORT).show()
                        }
                    }
                    is NFeEvent.Error -> Toast.makeText(requireContext(), event.message, Toast.LENGTH_SHORT).show()
                    else -> Unit
                }
            }
        }
    }

    private fun bindNota(n: NotaFiscal) {
        val numLabel = if (!n.numero.isNullOrBlank()) "NF-${n.numero}" else "NF #${n.id}"
        binding.toolbar.title     = numLabel
        binding.tvNumeroNfe.text  = numLabel
        binding.tvDestinatario.text = n.destinatario ?: "—"

        if (!n.destinatarioCnpj.isNullOrBlank()) {
            binding.tvCnpjDestinatario.text = "CNPJ: ${n.destinatarioCnpj}"
        } else {
            binding.tvCnpjDestinatario.isVisible = false
        }

        val (statusLabel, statusColorHex) = when (n.status.name.lowercase()) {
            "autorizada"  -> "Autorizada"  to "#4CAF50"
            "cancelada"   -> "Cancelada"   to "#F44336"
            "rejeitada"   -> "Rejeitada"   to "#FF5722"
            "processando" -> "Processando" to "#FF9800"
            "validada"    -> "Validada"    to "#2196F3"
            "denegada"    -> "Denegada"    to "#795548"
            else          -> n.status.displayName to "#9E9E9E"
        }
        binding.chipStatus.text = statusLabel
        runCatching {
            val color = Color.parseColor(statusColorHex)
            binding.chipStatus.chipBackgroundColor =
                android.content.res.ColorStateList.valueOf(color and 0x30FFFFFF or 0x20000000)
            binding.chipStatus.setTextColor(color)
        }

        binding.tvValorTotal.text  = currFmt.format(n.valorTotal)
        binding.tvDataEmissao.text = fmtDate(n.dataEmissao)

        binding.tvNaturezaOperacao.text = n.naturezaOperacao ?: "—"

        if (!n.serie.isNullOrBlank()) {
            binding.layoutSerie.isVisible = true
            binding.tvSerie.text          = n.serie
        }

        if (!n.protocolo.isNullOrBlank()) {
            binding.layoutProtocolo.isVisible = true
            binding.tvProtocolo.text           = n.protocolo
        }

        if (!n.dataAutorizacao.isNullOrBlank()) {
            binding.layoutAutorizacao.isVisible = true
            binding.tvDataAutorizacao.text       = fmtDate(n.dataAutorizacao)
        }

        if (!n.chaveAcesso.isNullOrBlank()) {
            binding.cardChave.isVisible    = true
            binding.tvChaveAcesso.text     = n.chaveAcesso
        }

        if (n.status.name.equals("AUTORIZADA", ignoreCase = true)) {
            binding.btnDanfe.isVisible = true
            binding.btnDanfe.setOnClickListener { viewModel.openDanfe(n.id) }
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
