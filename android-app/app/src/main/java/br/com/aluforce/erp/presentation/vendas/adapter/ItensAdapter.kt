package br.com.aluforce.erp.presentation.vendas.adapter

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.core.extensions.toBRL
import br.com.aluforce.erp.databinding.ItemPedidoItemBinding
import br.com.aluforce.erp.domain.model.ItemPedido

class ItensAdapter : ListAdapter<ItemPedido, ItensAdapter.ItemViewHolder>(ItemDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ItemViewHolder {
        val binding = ItemPedidoItemBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ItemViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ItemViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ItemViewHolder(
        private val binding: ItemPedidoItemBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: ItemPedido) {
            binding.tvProduto.text = item.descricao
            binding.tvCodigo.text = "ID: ${item.produtoId ?: "-"}"
            binding.tvQuantidade.text = "Qtd: ${item.quantidade}"
            binding.tvPrecoUnitario.text = item.precoUnitario.toBRL()
            binding.tvSubtotal.text = item.valorTotal.toBRL()
        }
    }

    private class ItemDiffCallback : DiffUtil.ItemCallback<ItemPedido>() {
        override fun areItemsTheSame(oldItem: ItemPedido, newItem: ItemPedido): Boolean =
            oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: ItemPedido, newItem: ItemPedido): Boolean =
            oldItem == newItem
    }
}
