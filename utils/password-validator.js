// =================================================================
// Utilitário de Validação de Senha - ALUFORCE v2.0
// Due Diligence Fix 2026-02-15
// =================================================================

/**
 * Valida a força de uma senha conforme política de segurança
 * @param {string} password - A senha a ser validada
 * @returns {{ valid: boolean, errors: string[] }} Resultado da validação
 */
function validatePasswordStrength(password) {
    const errors = [];
    
    if (!password || typeof password !== 'string') {
        return { valid: false, errors: ['Senha é obrigatória'] };
    }
    
    if (password.length < 10) {
        errors.push('A senha deve ter no mínimo 10 caracteres');
    }
    
    if (!/[A-Z]/.test(password)) {
        errors.push('A senha deve conter pelo menos uma letra maiúscula');
    }
    
    if (!/[a-z]/.test(password)) {
        errors.push('A senha deve conter pelo menos uma letra minúscula');
    }
    
    if (!/[0-9]/.test(password)) {
        errors.push('A senha deve conter pelo menos um número');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('A senha deve conter pelo menos um caractere especial (!@#$%...)');
    }
    
    // Verificar senhas comuns
    const commonPasswords = [
        'password', '123456', 'qwerty', 'admin', 'letmein',
        'welcome', 'monkey', 'master', 'dragon', 'login',
        'aluforce', 'senha123', 'mudar123'
    ];
    
    if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
        errors.push('A senha não pode conter palavras comuns ou previsíveis');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = { validatePasswordStrength };
