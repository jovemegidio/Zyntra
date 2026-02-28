package br.com.aluforce.erp.presentation.compras.adapter

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.toDisplayDate
import br.com.aluforce.erp.databinding.ItemPedidoCompraBinding
import br.com.aluforce.erp.domain.model.PedidoCompraResumo

class PedidosCompraAdapter(
    private val onItemClick: (PedidoCompraResumo) -> Unit
) : ListAdapter<PedidoCompraResumo, PedidosCompraAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemPedidoCompraBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(getItem(position))

    inner class ViewHolder(private val binding: ItemPedidoCompraBinding) : RecyclerView.ViewHolder(binding.root) {
        init { binding.root.setOnClickListener { val p = bindingAdapterPosition; if (p != RecyclerView.NO_POSITION) onItemClick(getItem(p)) } }
        fun bind(pedido: PedidoCompraResumo) {
            binding.tvNumero.text = pedido.numero
            binding.tvFornecedor.text = pedido.fornecedorNome
            binding.tvValor.text = pedido.valorTotal.toBRL()
            binding.tvData.text = pedido.createdAt.toDisplayDate()
            binding.tvStatus.text = pedido.status.displayName
            try { binding.tvStatus.setTextColor(Color.parseColor(pedido.status.color)) } catch (_: Exception) {}
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<PedidoCompraResumo>() {
        override fun areItemsTheSame(o: PedidoCompraResumo, n: PedidoCompraResumo) = o.id == n.id
        override fun areContentsTheSame(o: PedidoCompraResumo, n: PedidoCompraResumo) = o == n
    }
}
