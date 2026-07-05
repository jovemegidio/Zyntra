package br.com.aluforce.erp.presentation.rh

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
import br.com.aluforce.erp.databinding.FragmentFuncionarioDetailBinding
import br.com.aluforce.erp.domain.model.Funcionario
import coil.load
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale

@AndroidEntryPoint
class FuncionarioDetailFragment : Fragment() {

    private var _binding: FragmentFuncionarioDetailBinding? = null
    private val binding get() = _binding!!

    private val viewModel: RHViewModel by viewModels()
    private val args: FuncionarioDetailFragmentArgs by navArgs()

    private val inputFmt  = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.getDefault())
    private val inputFmt2 = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val outputFmt = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentFuncionarioDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.btnRetry.setOnClickListener { viewModel.loadFuncionarioDetail(args.funcionarioId) }
        binding.swipeRefresh.setOnRefreshListener { viewModel.loadFuncionarioDetail(args.funcionarioId) }

        viewModel.loadFuncionarioDetail(args.funcionarioId)
        observeState()
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.detailState.collectLatest { state ->
                binding.swipeRefresh.isRefreshing = false
                when (state) {
                    is FuncionarioDetailState.Loading -> {
                        binding.loadingOverlay.isVisible = true
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = false
                    }
                    is FuncionarioDetailState.Success -> {
                        binding.loadingOverlay.isVisible = false
                        binding.errorView.isVisible      = false
                        binding.scrollContent.isVisible  = true
                        bindFuncionario(state.funcionario)
                    }
                    is FuncionarioDetailState.Error -> {
                        binding.loadingOverlay.isVisible = false
                        binding.scrollContent.isVisible  = false
                        binding.errorView.isVisible      = true
                        binding.tvError.text             = state.message
                    }
                    is FuncionarioDetailState.Idle -> Unit
                }
            }
        }
    }

    private fun bindFuncionario(f: Funcionario) {
        binding.toolbar.title = f.nome.split(" ").take(2).joinToString(" ")
        binding.tvNome.text   = f.nome
        binding.tvCargo.text  = f.cargo ?: "Colaborador"

        val (statusLabel, statusColorHex) = when (f.status.lowercase()) {
            "ativo"    -> "Ativo"    to "#4CAF50"
            "inativo"  -> "Inativo"  to "#F44336"
            "ferias"   -> "Férias"   to "#2196F3"
            "afastado" -> "Afastado" to "#FF9800"
            else       -> f.status   to "#9E9E9E"
        }
        binding.chipStatus.text = statusLabel
        runCatching {
            val color = Color.parseColor(statusColorHex)
            binding.chipStatus.chipBackgroundColor =
                android.content.res.ColorStateList.valueOf(color and 0x30FFFFFF or 0x20000000)
            binding.chipStatus.setTextColor(color)
        }

        binding.tvDepartamento.text = f.departamento ?: "—"
        binding.tvAdmissao.text     = fmtDate(f.dataAdmissao)

        if (!f.email.isNullOrBlank()) {
            binding.layoutEmail.isVisible = true
            binding.tvEmail.text          = f.email
        }

        if (!f.telefone.isNullOrBlank()) {
            binding.layoutTelefone.isVisible = true
            binding.tvTelefone.text          = f.telefone
        }

        val endereco = listOfNotNull(f.endereco, f.cidade, f.estado).filter { it.isNotBlank() }.joinToString(", ")
        if (endereco.isNotBlank()) {
            binding.cardLocalizacao.isVisible = true
            binding.tvEndereco.text           = endereco
        }

        if (!f.avatar.isNullOrBlank()) {
            binding.ivAvatar.load(f.avatar)
        } else {
            binding.ivAvatar.setBackgroundColor(Color.parseColor("#19295e"))
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
