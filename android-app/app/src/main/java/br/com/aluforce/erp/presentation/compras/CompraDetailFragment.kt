package br.com.aluforce.erp.presentation.compras

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.navArgs
import br.com.aluforce.erp.R
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class CompraDetailFragment : Fragment() {

    private val viewModel: ComprasViewModel by viewModels()
    private val args: CompraDetailFragmentArgs by navArgs()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_detail_placeholder, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        view.findViewById<TextView>(R.id.tvDetailTitle)?.text = "Pedido de Compra #${args.compraId}"
        viewModel.loadPedidoCompraDetail(args.compraId)
    }
}
