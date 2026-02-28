package br.com.aluforce.erp.presentation.financeiro.adapter

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.toDisplayDate
import br.com.aluforce.erp.databinding.ItemContaBinding
import br.com.aluforce.erp.domain.model.ContaPagar

class ContasPagarAdapter(
    private val onItemClick: (ContaPagar) -> Unit
) : ListAdapter<ContaPagar, ContasPagarAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemContaBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(getItem(position))

    inner class ViewHolder(private val binding: ItemContaBinding) : RecyclerView.ViewHolder(binding.root) {
        init { binding.root.setOnClickListener { val p = bindingAdapterPosition; if (p != RecyclerView.NO_POSITION) onItemClick(getItem(p)) } }
        fun bind(conta: ContaPagar) {
            binding.tvDescricao.text = conta.descricao
            binding.tvEntidade.text = conta.fornecedor ?: "-"
            binding.tvValor.text = conta.valor.toBRL()
            binding.tvVencimento.text = conta.dataVencimento.toDisplayDate()
            binding.tvStatus.text = conta.status.displayName
            try { binding.tvStatus.setTextColor(Color.parseColor(conta.status.color)) } catch (_: Exception) {}
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<ContaPagar>() {
        override fun areItemsTheSame(o: ContaPagar, n: ContaPagar) = o.id == n.id
        override fun areContentsTheSame(o: ContaPagar, n: ContaPagar) = o == n
    }
}
