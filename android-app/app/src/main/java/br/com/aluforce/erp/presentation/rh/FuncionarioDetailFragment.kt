package br.com.aluforce.erp.presentation.rh

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
class FuncionarioDetailFragment : Fragment() {

    private val viewModel: RHViewModel by viewModels()
    private val args: FuncionarioDetailFragmentArgs by navArgs()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_detail_placeholder, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        view.findViewById<TextView>(R.id.tvDetailTitle)?.text = "Funcionário #${args.funcionarioId}"
        viewModel.loadFuncionarioDetail(args.funcionarioId)
    }
}
