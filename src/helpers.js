/**
 * Máscara LGPD para CPF (ex: 123.***.***-01)
 */
const maskCPF_LGPD = (cpf) => {
    if (!cpf) return '';
    const digits = cpf.replace(/\D/g, '');
    if (digits.length !== 11) return cpf;
    return `${digits.substr(0,3)}.***.***-${digits.substr(9,2)}`;
};

/**
 * Máscara LGPD para salário (ex: R$ ***,**)
 */
const maskSalario_LGPD = (salario) => {
    if (!salario && salario !== 0) return '';
    return 'R$ ***,**';
};
// utils/helpers.js
// Funções auxiliares reutilizáveis

const crypto = require('crypto');

/**
 * Formata valores monetários para BRL
 */
const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
};

/**
 * Formata datas para padrão brasileiro
 */
const formatDate = (date, includeTime = false) => {
    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...(includeTime && {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
    };
    
    return new Intl.DateTimeFormat('pt-BR', options).format(new Date(date));
};

/**
 * Valida CNPJ
 */
const validateCNPJ = (cnpj) => {
    cnpj = cnpj.replace(/[^\d]/g, '');
    
    if (cnpj.length !== 14) return false;
    
    // Elimina CNPJs inválidos conhecidos
    if (/^(\d)\1+$/.test(cnpj)) return false;
    
    // Validação do primeiro dígito verificador
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    const digitos = cnpj.substring(tamanho);
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
};

/**
 * Valida CPF
 */
const validateCPF = (cpf) => {
    cpf = cpf.replace(/[^\d]/g, '');
    
    if (cpf.length !== 11) return false;
    
    // Elimina CPFs inválidos conhecidos
    if (/^(\d)\1+$/.test(cpf)) return false;
    
    // Validação do primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    
    let resto = 11 - (soma % 11);
    let digito1 = resto >= 10 ? 0 : resto;
    
    if (digito1 != cpf.charAt(9)) return false;
    
    // Validação do segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    
    resto = 11 - (soma % 11);
    const digito2 = resto >= 10 ? 0 : resto;
    
    if (digito2 != cpf.charAt(10)) return false;
    
    return true;
};

/**
 * Valida email
 */
const validateEmail = (email) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
};

/**
 * Gera hash seguro para senhas
 */
const generateHash = (text, algorithm = 'sha256') => {
    return crypto
        .createHash(algorithm)
        .update(text)
        .digest('hex');
};

/**
 * Gera token aleatório seguro
 */
const generateToken = (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
};

/**
 * Máscara para CNPJ
 */
const maskCNPJ = (cnpj) => {
    cnpj = cnpj.replace(/[^\d]/g, '');
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
};

/**
 * Máscara para CPF
 */
const maskCPF = (cpf) => {
    cpf = cpf.replace(/[^\d]/g, '');
    return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
};

/**
 * Máscara para telefone
 */
const maskPhone = (phone) => {
    phone = phone.replace(/[^\d]/g, '');
    
    if (phone.length === 10) {
        return phone.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    } else if (phone.length === 11) {
        return phone.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    }
    
    return phone;
};

/**
 * Máscara para CEP
 */
const maskCEP = (cep) => {
    cep = cep.replace(/[^\d]/g, '');
    return cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
};

/**
 * Remove acentos de string
 */
const removeAccents = (str) => {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/**
 * Converte string para slug
 */
const slugify = (str) => {
    return removeAccents(str)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

/**
 * Paginação
 */
const paginate = (page = 1, limit = 20) => {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    return {
        limit: parseInt(limit),
        offset: Math.max(0, offset)
    };
};

/**
 * Calcula porcentagem
 */
const calculatePercentage = (value, total) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100 * 100) / 100;
};

/**
 * Trunca texto
 */
const truncate = (str, length = 100, suffix = '...') => {
    if (str.length <= length) return str;
    return str.substring(0, length) + suffix;
};

/**
 * Capitaliza primeira letra
 */
const capitalize = (str) => {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Capitaliza cada palavra
 */
const capitalizeWords = (str) => {
    return str.split(' ').map(capitalize).join(' ');
};

/**
 * Verifica se objeto está vazio
 */
const isEmpty = (obj) => {
    return Object.keys(obj).length === 0;
};

/**
 * Delay assíncrono
 */
const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry com backoff exponencial
 */
const retryWithBackoff = async (fn, maxRetries = 3, delay = 1000) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await sleep(delay * Math.pow(2, i));
        }
    }
};

/**
 * Agrupa array por propriedade
 */
const groupBy = (array, key) => {
    return array.reduce((result, item) => {
        const groupKey = item[key];
        if (!result[groupKey]) {
            result[groupKey] = [];
        }
        result[groupKey].push(item);
        return result;
    }, {});
};

/**
 * Remove duplicatas de array
 */
const unique = (array) => {
    return [...new Set(array)];
};

/**
 * Ordena array de objetos
 */
const sortBy = (array, key, order = 'asc') => {
    return array.sort((a, b) => {
        if (order === 'asc') {
            return a[key] > b[key] ? 1 : -1;
        }
        return a[key] < b[key] ? 1 : -1;
    });
};

module.exports = {
    formatCurrency,
    formatDate,
    validateCNPJ,
    validateCPF,
    validateEmail,
    generateHash,
    generateToken,
    maskCNPJ,
    maskCPF,
    maskCPF_LGPD,
    maskSalario_LGPD,
    maskPhone,
    maskCEP,
    removeAccents,
    slugify,
    paginate,
    calculatePercentage,
    truncate,
    capitalize,
    capitalizeWords,
    isEmpty,
    sleep,
    retryWithBackoff,
    groupBy,
    unique,
    sortBy
};
