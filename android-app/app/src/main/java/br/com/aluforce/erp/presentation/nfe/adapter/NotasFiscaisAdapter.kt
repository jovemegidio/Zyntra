package br.com.aluforce.erp.presentation.nfe.adapter

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.toDisplayDate
import br.com.aluforce.erp.databinding.ItemNotaFiscalBinding
import br.com.aluforce.erp.domain.model.NotaFiscal

class NotasFiscaisAdapter(
    private val onItemClick: (NotaFiscal) -> Unit
) : ListAdapter<NotaFiscal, NotasFiscaisAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemNotaFiscalBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(getItem(position))

    inner class ViewHolder(private val binding: ItemNotaFiscalBinding) : RecyclerView.ViewHolder(binding.root) {
        init { binding.root.setOnClickListener { val p = bindingAdapterPosition; if (p != RecyclerView.NO_POSITION) onItemClick(getItem(p)) } }
        fun bind(nfe: NotaFiscal) {
            binding.tvNumero.text = nfe.numero ?: "#${nfe.id}"
            binding.tvDestinatario.text = nfe.destinatario ?: "-"
            binding.tvValor.text = nfe.valorTotal.toBRL()
            binding.tvData.text = nfe.dataEmissao?.toDisplayDate() ?: "-"
            binding.tvStatus.text = nfe.status.displayName
            try { binding.tvStatus.setTextColor(Color.parseColor(nfe.status.color)) } catch (_: Exception) {}
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<NotaFiscal>() {
        override fun areItemsTheSame(o: NotaFiscal, n: NotaFiscal) = o.id == n.id
        override fun areContentsTheSame(o: NotaFiscal, n: NotaFiscal) = o == n
    }
}
