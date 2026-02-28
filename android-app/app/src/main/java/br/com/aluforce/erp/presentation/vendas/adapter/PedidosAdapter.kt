package br.com.aluforce.erp.presentation.vendas.adapter

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.core.extensions.toDisplayDate
import br.com.aluforce.erp.databinding.ItemPedidoBinding
import br.com.aluforce.erp.domain.model.PedidoResumo

/**
 * RecyclerView adapter for Pedidos list.
 * Uses ListAdapter with DiffUtil for efficient updates.
 */
class PedidosAdapter(
    private val onItemClick: (PedidoResumo) -> Unit
) : ListAdapter<PedidoResumo, PedidosAdapter.PedidoViewHolder>(PedidoDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PedidoViewHolder {
        val binding = ItemPedidoBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return PedidoViewHolder(binding)
    }

    override fun onBindViewHolder(holder: PedidoViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class PedidoViewHolder(
        private val binding: ItemPedidoBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        init {
            binding.root.setOnClickListener {
                val position = bindingAdapterPosition
                if (position != RecyclerView.NO_POSITION) {
                    onItemClick(getItem(position))
                }
            }
        }

        fun bind(pedido: PedidoResumo) {
            binding.apply {
                tvNumero.text = pedido.numero
                tvCliente.text = pedido.clienteNome
                tvValor.text = pedido.valorTotal.toBRL()
                tvStatus.text = pedido.status.displayName
                tvData.text = pedido.createdAt.toDisplayDate()
                tvVendedor.text = pedido.vendedor ?: "-"

                // Status chip color
                try {
                    chipStatus.setChipBackgroundColorResource(android.R.color.transparent)
                    chipStatus.text = pedido.status.displayName
                    chipStatus.setTextColor(Color.parseColor(pedido.status.color))
                    chipStatus.chipStrokeColor = android.content.res.ColorStateList.valueOf(
                        Color.parseColor(pedido.status.color)
                    )
                } catch (e: Exception) {
                    chipStatus.text = pedido.status.displayName
                }
            }
        }
    }

    class PedidoDiffCallback : DiffUtil.ItemCallback<PedidoResumo>() {
        override fun areItemsTheSame(oldItem: PedidoResumo, newItem: PedidoResumo): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: PedidoResumo, newItem: PedidoResumo): Boolean {
            return oldItem == newItem
        }
    }
}
