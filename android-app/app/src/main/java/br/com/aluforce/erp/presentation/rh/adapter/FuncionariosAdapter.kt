package br.com.aluforce.erp.presentation.rh.adapter

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import br.com.aluforce.erp.databinding.ItemFuncionarioBinding
import br.com.aluforce.erp.domain.model.Funcionario

class FuncionariosAdapter(
    private val onItemClick: (Funcionario) -> Unit
) : ListAdapter<Funcionario, FuncionariosAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemFuncionarioBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(getItem(position))

    inner class ViewHolder(private val binding: ItemFuncionarioBinding) : RecyclerView.ViewHolder(binding.root) {
        init { binding.root.setOnClickListener { val p = bindingAdapterPosition; if (p != RecyclerView.NO_POSITION) onItemClick(getItem(p)) } }
        fun bind(func: Funcionario) {
            binding.tvNome.text = func.nome
            binding.tvCargo.text = func.cargo ?: "-"
            binding.tvDepartamento.text = func.departamento ?: "-"
            binding.tvEmail.text = func.email ?: "-"
            binding.tvStatus.text = func.status.replaceFirstChar { it.uppercase() }
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<Funcionario>() {
        override fun areItemsTheSame(o: Funcionario, n: Funcionario) = o.id == n.id
        override fun areContentsTheSame(o: Funcionario, n: Funcionario) = o == n
    }
}
