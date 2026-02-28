package br.com.aluforce.erp.presentation.clientes

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.navArgs
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.visibleIf
import br.com.aluforce.erp.databinding.FragmentClienteDetailBinding
import br.com.aluforce.erp.domain.model.Cliente
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class ClienteDetailFragment : Fragment() {

    private var _binding: FragmentClienteDetailBinding? = null
    private val binding get() = _binding!!
    private val viewModel: ClientesViewModel by viewModels()
    private val args: ClienteDetailFragmentArgs by navArgs()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentClienteDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        viewModel.loadClienteDetail(args.clienteId)
        observeState()
    }

    private fun observeState() {
        collectFlow(viewModel.detailState) { state ->
            binding.progressBar.visibleIf(state is ClienteDetailState.Loading)
            binding.contentLayout.visibleIf(state is ClienteDetailState.Success)
            when (state) {
                is ClienteDetailState.Success -> bindCliente(state.cliente)
                is ClienteDetailState.Error -> showSnackbar(state.message)
                else -> {}
            }
        }
    }

    private fun bindCliente(c: Cliente) {
        binding.tvNome.text = c.nome
        binding.tvDocumento.text = c.documento ?: "-"
        binding.tvEmail.text = c.email ?: "-"
        binding.tvTelefone.text = c.telefone ?: "-"
        binding.tvEndereco.text = c.localidade
        binding.tvSegmento.text = c.segmento ?: "-"
        binding.tvStatus.text = c.status.replaceFirstChar { it.uppercase() }
        binding.tvTotalPedidos.text = c.totalPedidos.toString()
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}
