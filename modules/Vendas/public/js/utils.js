/**
 * ALUFORCE ERP - Módulo de Utilitários
 * Funções utilitárias: debounce, throttle, formatadores, etc.
 * @version 1.0.0
 * @date 2026-02-01
 */

const AluforceUtils = (function() {
    'use strict';

    /**
     * Debounce - Executa função após delay, cancelando execuções anteriores
     * @param {Function} func - Função a ser executada
     * @param {number} delay - Delay em milissegundos
     * @returns {Function} Função com debounce
     */
    function debounce(func, delay = 300) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    /**
     * Throttle - Limita execução a uma vez por período
     * @param {Function} func - Função a ser executada
     * @param {number} limit - Intervalo mínimo em milissegundos
     * @returns {Function} Função com throttle
     */
    function throttle(func, limit = 300) {
        let lastFunc;
        let lastRan;
        return function(...args) {
            if (!lastRan) {
                func.apply(this, args);
                lastRan = Date.now();
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(() => {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(this, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        };
    }

    // ========================================
    // FORMATADORES
    // ========================================

    /**
     * Formata CNPJ: XX.XXX.XXX/XXXX-XX
     * @param {string} cnpj - CNPJ apenas números
     * @returns {string} CNPJ formatado
     */
    function formatarCNPJ(cnpj) {
        const numeros = String(cnpj).replace(/\D/g, '').slice(0, 14);
        return numeros.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }

    /**
     * Formata CPF: XXX.XXX.XXX-XX
     * @param {string} cpf - CPF apenas números
     * @returns {string} CPF formatado
     */
    function formatarCPF(cpf) {
        const numeros = String(cpf).replace(/\D/g, '').slice(0, 11);
        return numeros.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }

    /**
     * Formata CEP: XXXXX-XXX
     * @param {string} cep - CEP apenas números
     * @returns {string} CEP formatado
     */
    function formatarCEP(cep) {
        const numeros = String(cep).replace(/\D/g, '').slice(0, 8);
        return numeros.replace(/^(\d{5})(\d{3})$/, '$1-$2');
    }

    /**
     * Formata Telefone: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
     * @param {string} telefone - Telefone apenas números
     * @returns {string} Telefone formatado
     */
    function formatarTelefone(telefone) {
        const numeros = String(telefone).replace(/\D/g, '').slice(0, 11);
        if (numeros.length === 11) {
            return numeros.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
        } else if (numeros.length === 10) {
            return numeros.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
        }
        return numeros;
    }

    /**
     * Formata valor monetário em R$
     * @param {number|string} valor - Valor numérico
     * @param {boolean} showSymbol - Mostrar símbolo R$
     * @returns {string} Valor formatado
     */
    function formatarMoeda(valor, showSymbol = true) {
        const num = parseFloat(valor) || 0;
        const formatted = num.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return showSymbol ? `R$ ${formatted}` : formatted;
    }

    /**
     * Formata data para exibição brasileira
     * @param {string|Date} data - Data a ser formatada
     * @param {boolean} showTime - Incluir hora
     * @returns {string} Data formatada
     */
    function formatarData(data, showTime = false) {
        if (!data) return '';
        const d = new Date(data);
        if (isNaN(d.getTime())) return '';
        
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        };
        
        if (showTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        
        return d.toLocaleDateString('pt-BR', options);
    }

    /**
     * Formata data para input HTML (YYYY-MM-DD)
     * @param {string|Date} data - Data a ser formatada
     * @returns {string} Data no formato ISO
     */
    function formatarDataInput(data) {
        if (!data) return '';
        const d = new Date(data);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
    }

    // ========================================
    // FORMATADORES DE INPUT (enquanto digita)
    // ========================================

    /**
     * Aplica formatação de CNPJ em input enquanto digita
     * @param {HTMLInputElement} input - Elemento input
     */
    function formatarCNPJInput(input) {
        let value = input.value.replace(/\D/g, '').slice(0, 14);
        
        if (value.length > 12) {
            value = value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
        } else if (value.length > 8) {
            value = value.replace(/^(\d{2})(\d{3})(\d{3})(\d+)$/, '$1.$2.$3/$4');
        } else if (value.length > 5) {
            value = value.replace(/^(\d{2})(\d{3})(\d+)$/, '$1.$2.$3');
        } else if (value.length > 2) {
            value = value.replace(/^(\d{2})(\d+)$/, '$1.$2');
        }
        input.value = value;
    }

    /**
     * Aplica formatação de CPF em input enquanto digita
     * @param {HTMLInputElement} input - Elemento input
     */
    function formatarCPFInput(input) {
        let value = input.value.replace(/\D/g, '').slice(0, 11);
        
        if (value.length > 9) {
            value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
        } else if (value.length > 6) {
            value = value.replace(/^(\d{3})(\d{3})(\d+)$/, '$1.$2.$3');
        } else if (value.length > 3) {
            value = value.replace(/^(\d{3})(\d+)$/, '$1.$2');
        }
        input.value = value;
    }

    /**
     * Aplica formatação de CEP em input enquanto digita
     * @param {HTMLInputElement} input - Elemento input
     */
    function formatarCEPInput(input) {
        let value = input.value.replace(/\D/g, '').slice(0, 8);
        if (value.length > 5) {
            value = value.replace(/^(\d{5})(\d+)$/, '$1-$2');
        }
        input.value = value;
    }

    /**
     * Aplica formatação de telefone em input enquanto digita
     * @param {HTMLInputElement} input - Elemento input
     */
    function formatarTelefoneInput(input) {
        let value = input.value.replace(/\D/g, '').slice(0, 11);
        
        if (value.length > 10) {
            value = value.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
        } else if (value.length > 6) {
            value = value.replace(/^(\d{2})(\d{4})(\d+)$/, '($1) $2-$3');
        } else if (value.length > 2) {
            value = value.replace(/^(\d{2})(\d+)$/, '($1) $2');
        }
        input.value = value;
    }

    /**
     * Aplica formatação de moeda em input enquanto digita
     * @param {HTMLInputElement} input - Elemento input
     */
    function formatarMoedaInput(input) {
        let value = input.value.replace(/\D/g, '');
        value = (parseInt(value || '0') / 100).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        input.value = value;
    }

    // ========================================
    // UTILITÁRIOS GERAIS
    // ========================================

    /**
     * Remove acentos de uma string
     * @param {string} str - String com acentos
     * @returns {string} String sem acentos
     */
    function removerAcentos(str) {
        return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Gera ID único
     * @returns {string} ID único
     */
    function gerarId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Copia texto para área de transferência
     * @param {string} texto - Texto a ser copiado
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async function copiarParaClipboard(texto) {
        try {
            await navigator.clipboard.writeText(texto);
            return true;
        } catch (err) {
            // Fallback para navegadores antigos
            const textarea = document.createElement('textarea');
            textarea.value = texto;
            document.body.appendChild(textarea);
            textarea.select();
            const result = document.execCommand('copy');
            document.body.removeChild(textarea);
            return result;
        }
    }

    /**
     * Escapa HTML para prevenir XSS
     * @param {string} str - String a ser escapada
     * @returns {string} String escapada
     */
    function escaparHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Expor funções públicas
    return {
        // Controle de fluxo
        debounce,
        throttle,
        
        // Formatadores de retorno
        formatarCNPJ,
        formatarCPF,
        formatarCEP,
        formatarTelefone,
        formatarMoeda,
        formatarData,
        formatarDataInput,
        
        // Formatadores de input
        formatarCNPJInput,
        formatarCPFInput,
        formatarCEPInput,
        formatarTelefoneInput,
        formatarMoedaInput,
        
        // Utilitários gerais
        removerAcentos,
        gerarId,
        copiarParaClipboard,
        escaparHTML
    };
})();

// Compatibilidade global
if (typeof window !== 'undefined') {
    window.AluforceUtils = AluforceUtils;
    // Funções globais para compatibilidade
    window.debounce = AluforceUtils.debounce;
    window.throttle = AluforceUtils.throttle;
}
