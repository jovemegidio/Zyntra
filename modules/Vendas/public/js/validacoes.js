/**
 * ALUFORCE ERP - Módulo de Validações
 * Funções de validação de CPF, CNPJ, Email, CEP, etc.
 * @version 1.0.0
 * @date 2026-02-01
 */

const AluforceValidacoes = (function() {
    'use strict';

    /**
     * Valida CNPJ com verificação de dígitos verificadores
     * @param {string} cnpj - CNPJ a ser validado (com ou sem formatação)
     * @returns {boolean} true se válido, false se inválido
     */
    function validarCNPJ(cnpj) {
        cnpj = String(cnpj).replace(/[^\d]+/g, '');
        if (cnpj.length !== 14) return false;
        
        // Rejeita CNPJs com todos os dígitos iguais
        if (/^(\d)\1+$/.test(cnpj)) return false;
        
        // Validação do primeiro dígito verificador
        let tamanho = cnpj.length - 2;
        let numeros = cnpj.substring(0, tamanho);
        let digitos = cnpj.substring(tamanho);
        let soma = 0;
        let pos = tamanho - 7;
        
        for (let i = tamanho; i >= 1; i--) {
            soma += numeros.charAt(tamanho - i) * pos--;
            if (pos < 2) pos = 9;
        }
        
        let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
        if (resultado != digitos.charAt(0)) return false;
        
        // Validação do segundo dígito verificador
        tamanho = tamanho + 1;
        numeros = cnpj.substring(0, tamanho);
        soma = 0;
        pos = tamanho - 7;
        
        for (let i = tamanho; i >= 1; i--) {
            soma += numeros.charAt(tamanho - i) * pos--;
            if (pos < 2) pos = 9;
        }
        
        resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
        if (resultado != digitos.charAt(1)) return false;
        
        return true;
    }

    /**
     * Valida CPF com verificação de dígitos verificadores
     * @param {string} cpf - CPF a ser validado (com ou sem formatação)
     * @returns {boolean} true se válido, false se inválido
     */
    function validarCPF(cpf) {
        cpf = String(cpf).replace(/[^\d]+/g, '');
        if (cpf.length !== 11) return false;
        
        // Rejeita CPFs com todos os dígitos iguais
        if (/^(\d)\1+$/.test(cpf)) return false;
        
        // Validação do primeiro dígito verificador
        let soma = 0;
        for (let i = 0; i < 9; i++) {
            soma += parseInt(cpf.charAt(i)) * (10 - i);
        }
        let resto = 11 - (soma % 11);
        let digito1 = resto >= 10 ? 0 : resto;
        if (digito1 != parseInt(cpf.charAt(9))) return false;
        
        // Validação do segundo dígito verificador
        soma = 0;
        for (let i = 0; i < 10; i++) {
            soma += parseInt(cpf.charAt(i)) * (11 - i);
        }
        resto = 11 - (soma % 11);
        let digito2 = resto >= 10 ? 0 : resto;
        if (digito2 != parseInt(cpf.charAt(10))) return false;
        
        return true;
    }

    /**
     * Valida CPF ou CNPJ automaticamente baseado no tamanho
     * @param {string} documento - CPF ou CNPJ (com ou sem formatação)
     * @returns {object} { valido: boolean, tipo: 'cpf'|'cnpj'|null, mensagem: string }
     */
    function validarDocumento(documento) {
        const numeros = String(documento).replace(/[^\d]+/g, '');
        
        if (numeros.length === 11) {
            const valido = validarCPF(numeros);
            return { 
                valido, 
                tipo: 'cpf', 
                mensagem: valido ? 'CPF válido' : 'CPF inválido! Verifique os dígitos.' 
            };
        } else if (numeros.length === 14) {
            const valido = validarCNPJ(numeros);
            return { 
                valido, 
                tipo: 'cnpj', 
                mensagem: valido ? 'CNPJ válido' : 'CNPJ inválido! Verifique os dígitos.' 
            };
        } else if (numeros.length === 0) {
            return { valido: true, tipo: null, mensagem: '' };
        } else {
            return { 
                valido: false, 
                tipo: null, 
                mensagem: 'Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)' 
            };
        }
    }

    /**
     * Valida formato de email
     * @param {string} email - Email a ser validado
     * @returns {boolean} true se válido
     */
    function validarEmail(email) {
        if (!email) return true;
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(String(email).trim());
    }

    /**
     * Valida CEP brasileiro
     * @param {string} cep - CEP a ser validado
     * @returns {boolean} true se válido
     */
    function validarCEP(cep) {
        if (!cep) return true;
        const numeros = String(cep).replace(/[^\d]+/g, '');
        return numeros.length === 8;
    }

    /**
     * Valida telefone brasileiro
     * @param {string} telefone - Telefone a ser validado
     * @returns {boolean} true se válido
     */
    function validarTelefone(telefone) {
        if (!telefone) return true;
        const numeros = String(telefone).replace(/[^\d]+/g, '');
        return numeros.length >= 10 && numeros.length <= 11;
    }

    /**
     * Valida Inscrição Estadual
     * @param {string} ie - Inscrição Estadual
     * @param {string} uf - Estado (opcional)
     * @returns {boolean} true se válido
     */
    function validarIE(ie, uf) {
        if (!ie || ie.toUpperCase() === 'ISENTO') return true;
        const numeros = String(ie).replace(/[^\d]+/g, '');
        // Validação básica: entre 8 e 14 dígitos
        return numeros.length >= 8 && numeros.length <= 14;
    }

    // Expor funções públicas
    return {
        validarCNPJ,
        validarCPF,
        validarDocumento,
        validarEmail,
        validarCEP,
        validarTelefone,
        validarIE,
        // Aliases
        cnpj: validarCNPJ,
        cpf: validarCPF,
        email: validarEmail,
        cep: validarCEP,
        telefone: validarTelefone
    };
})();

// Compatibilidade global
if (typeof window !== 'undefined') {
    window.AluforceValidacoes = AluforceValidacoes;
    // Funções globais para compatibilidade
    window.validarCNPJ = AluforceValidacoes.validarCNPJ;
    window.validarCPF = AluforceValidacoes.validarCPF;
    window.validarDocumento = AluforceValidacoes.validarDocumento;
    window.validarEmail = AluforceValidacoes.validarEmail;
}
