package br.com.aluforce.erp.presentation.clientes.adapter

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.databinding.ItemClienteBinding
import br.com.aluforce.erp.domain.model.Cliente

class ClientesAdapter(
    private val onItemClick: (Cliente) -> Unit
) : ListAdapter<Cliente, ClientesAdapter.ClienteViewHolder>(ClienteDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ClienteViewHolder {
        val binding = ItemClienteBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ClienteViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ClienteViewHolder, position: Int) = holder.bind(getItem(position))

    inner class ClienteViewHolder(private val binding: ItemClienteBinding) : RecyclerView.ViewHolder(binding.root) {
        init { binding.root.setOnClickListener { val p = bindingAdapterPosition; if (p != RecyclerView.NO_POSITION) onItemClick(getItem(p)) } }
        fun bind(cliente: Cliente) {
            binding.tvNome.text = cliente.nome
            binding.tvDocumento.text = cliente.documento ?: "-"
            binding.tvLocalidade.text = cliente.localidade
            binding.tvEmail.text = cliente.email ?: "-"
            binding.tvTelefone.text = cliente.telefone ?: "-"
        }
    }

    class ClienteDiffCallback : DiffUtil.ItemCallback<Cliente>() {
        override fun areItemsTheSame(o: Cliente, n: Cliente) = o.id == n.id
        override fun areContentsTheSame(o: Cliente, n: Cliente) = o == n
    }
}
