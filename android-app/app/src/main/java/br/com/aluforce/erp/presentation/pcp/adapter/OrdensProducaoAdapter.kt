package br.com.aluforce.erp.presentation.pcp.adapter

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.databinding.ItemOrdemProducaoBinding
import br.com.aluforce.erp.domain.model.OrdemProducaoResumo

class OrdensProducaoAdapter(
    private val onItemClick: (OrdemProducaoResumo) -> Unit
) : ListAdapter<OrdemProducaoResumo, OrdensProducaoAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemOrdemProducaoBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(getItem(position))

    inner class ViewHolder(private val binding: ItemOrdemProducaoBinding) : RecyclerView.ViewHolder(binding.root) {
        init { binding.root.setOnClickListener { val p = bindingAdapterPosition; if (p != RecyclerView.NO_POSITION) onItemClick(getItem(p)) } }
        fun bind(ordem: OrdemProducaoResumo) {
            binding.tvNumero.text = ordem.numero
            binding.tvProduto.text = ordem.produto
            binding.tvQuantidade.text = "${ordem.quantidadeProduzida.toInt()}/${ordem.quantidade.toInt()}"
            binding.tvStatus.text = ordem.status.displayName
            binding.tvPrioridade.text = ordem.prioridade ?: "Normal"
            binding.tvResponsavel.text = ordem.responsavel ?: "-"
            try { binding.tvStatus.setTextColor(Color.parseColor(ordem.status.color)) } catch (_: Exception) {}
            // Progress bar
            val progress = if (ordem.quantidade > 0) ((ordem.quantidadeProduzida / ordem.quantidade) * 100).toInt() else 0
            binding.progressBar.progress = progress.coerceIn(0, 100)
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<OrdemProducaoResumo>() {
        override fun areItemsTheSame(o: OrdemProducaoResumo, n: OrdemProducaoResumo) = o.id == n.id
        override fun areContentsTheSame(o: OrdemProducaoResumo, n: OrdemProducaoResumo) = o == n
    }
}
