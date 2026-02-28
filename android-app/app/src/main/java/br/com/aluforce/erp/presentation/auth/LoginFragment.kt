package br.com.aluforce.erp.presentation.auth

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.navigation.fragment.findNavController
import br.com.aluforce.erp.R
import br.com.aluforce.erp.core.extensions.collectFlow
import br.com.aluforce.erp.core.extensions.gone
import br.com.aluforce.erp.core.extensions.hideKeyboard
import br.com.aluforce.erp.core.extensions.showSnackbar
import br.com.aluforce.erp.core.extensions.visible
import br.com.aluforce.erp.databinding.FragmentLoginBinding
import dagger.hilt.android.AndroidEntryPoint

/**
 * Login screen fragment.
 *
 * Features:
 * - Email + password input with validation
 * - Loading state with disabled inputs
 * - Error display via Snackbar
 * - Navigation to Dashboard on success
 */
@AndroidEntryPoint
class LoginFragment : Fragment() {

    private var _binding: FragmentLoginBinding? = null
    private val binding get() = _binding!!

    private val authViewModel: AuthViewModel by activityViewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLoginBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupUI()
        observeState()
    }

    private fun setupUI() {
        binding.btnLogin.setOnClickListener {
            val email = binding.etEmail.text.toString().trim()
            val password = binding.etPassword.text.toString()

            // Clear previous errors
            binding.tilEmail.error = null
            binding.tilPassword.error = null

            // Client-side validation
            var hasError = false
            if (email.isBlank()) {
                binding.tilEmail.error = "E-mail é obrigatório"
                hasError = true
            }
            if (password.isBlank()) {
                binding.tilPassword.error = "Senha é obrigatória"
                hasError = true
            }

            if (!hasError) {
                binding.root.hideKeyboard()
                authViewModel.login(email, password)
            }
        }
    }

    private fun observeState() {
        collectFlow(authViewModel.loginState) { state ->
            when (state) {
                is LoginState.Idle -> {
                    setInputsEnabled(true)
                    binding.progressBar.gone()
                }
                is LoginState.Loading -> {
                    setInputsEnabled(false)
                    binding.progressBar.visible()
                }
                is LoginState.Success -> {
                    binding.progressBar.gone()
                    findNavController().navigate(R.id.action_login_to_dashboard)
                }
                is LoginState.Error -> {
                    setInputsEnabled(true)
                    binding.progressBar.gone()
                    showSnackbar(state.message, com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                    authViewModel.resetLoginState()
                }
            }
        }
    }

    private fun setInputsEnabled(enabled: Boolean) {
        binding.etEmail.isEnabled = enabled
        binding.etPassword.isEnabled = enabled
        binding.btnLogin.isEnabled = enabled
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
