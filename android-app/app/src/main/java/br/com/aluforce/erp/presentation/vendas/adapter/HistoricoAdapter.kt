package br.com.aluforce.erp.presentation.vendas.adapter

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.toDisplayDateTime
import br.com.aluforce.erp.databinding.ItemHistoricoBinding
import br.com.aluforce.erp.domain.model.HistoricoPedido

class HistoricoAdapter : ListAdapter<HistoricoPedido, HistoricoAdapter.HistoricoViewHolder>(HistoricoDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): HistoricoViewHolder {
        val binding = ItemHistoricoBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return HistoricoViewHolder(binding)
    }

    override fun onBindViewHolder(holder: HistoricoViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class HistoricoViewHolder(
        private val binding: ItemHistoricoBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(historico: HistoricoPedido) {
            binding.tvAcao.text = historico.acao
            binding.tvUsuario.text = historico.usuario
            binding.tvData.text = historico.createdAt.toDisplayDateTime()
            binding.tvDescricao.text = historico.descricao
        }
    }

    private class HistoricoDiffCallback : DiffUtil.ItemCallback<HistoricoPedido>() {
        override fun areItemsTheSame(oldItem: HistoricoPedido, newItem: HistoricoPedido): Boolean =
            oldItem.createdAt == newItem.createdAt && oldItem.acao == newItem.acao

        override fun areContentsTheSame(oldItem: HistoricoPedido, newItem: HistoricoPedido): Boolean =
            oldItem == newItem
    }
}
