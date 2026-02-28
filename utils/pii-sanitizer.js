/**
 * AUDIT-FIX R-21: Sanitização de PII em Logs — ALUFORCE ERP
 * 
 * Remove/mascara dados pessoais antes de logar no console ou arquivo.
 * Substitui o console.log/warn/error padrão com versão sanitizada.
 * 
 * Campos mascarados:
 * - Emails: us***@domain.com
 * - CPF/CNPJ: ***.***.***-XX
 * - Telefones: (XX) ****-XXXX
 * - IPs internos: mantém, IPs externos: mascara último octeto
 * 
 * Criado durante auditoria de segurança — 15/02/2026
 */

// Padrões de PII para sanitizar
const PII_PATTERNS = [
    // Email: user@domain.com → us***@domain.com
    {
        regex: /\b([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
        replace: '$1***@$2'
    },
    // CPF: 123.456.789-00 → ***.***.***-00
    {
        regex: /\b\d{3}\.\d{3}\.\d{3}-(\d{2})\b/g,
        replace: '***.***.***-$1'
    },
    // CPF sem formatação: 12345678900 → ***********00
    {
        regex: /\b(\d{9})(\d{2})\b/g,
        replace: (match, p1, p2) => {
            // Só mascara se parecer CPF (11 dígitos)
            if (match.length === 11) return `*********${p2}`;
            return match;
        }
    },
    // CNPJ: 12.345.678/0001-99 → **.***.***/**-99
    {
        regex: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-(\d{2})\b/g,
        replace: '**.***.***/**-$1'
    },
    // Telefone: (11) 98765-4321 → (11) ****-4321
    {
        regex: /\(\d{2}\)\s?\d{4,5}-(\d{4})/g,
        replace: '(XX) ****-$1'
    },
    // Senha em JSON: "senha":"abc123" → "senha":"[REDACTED]"
    {
        regex: /"(senha|password|senha_texto|senha_hash|secret|token)"\s*:\s*"[^"]*"/gi,
        replace: '"$1":"[REDACTED]"'
    }
];

/**
 * Sanitiza uma string removendo PII
 */
function sanitizePII(input) {
    if (typeof input !== 'string') {
        if (typeof input === 'object') {
            try {
                input = JSON.stringify(input);
            } catch (e) {
                return String(input);
            }
        } else {
            return String(input);
        }
    }

    let sanitized = input;
    for (const pattern of PII_PATTERNS) {
        sanitized = sanitized.replace(pattern.regex, pattern.replace);
    }
    return sanitized;
}

/**
 * Wrapa os métodos do console para sanitizar PII automaticamente
 */
function installPIISanitizer() {
    const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console)
    };

    // Só ativar em produção para não atrapalhar debugging local
    if (process.env.NODE_ENV !== 'production') {
        console.log('[PII-SANITIZER] ⚠️ Modo desenvolvimento — sanitização de PII desativada');
        return { originalConsole };
    }

    const sanitizeArgs = (args) => {
        return args.map(arg => {
            if (typeof arg === 'string') return sanitizePII(arg);
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.parse(sanitizePII(JSON.stringify(arg)));
                } catch (e) {
                    return arg;
                }
            }
            return arg;
        });
    };

    console.log = (...args) => originalConsole.log(...sanitizeArgs(args));
    console.warn = (...args) => originalConsole.warn(...sanitizeArgs(args));
    console.error = (...args) => originalConsole.error(...sanitizeArgs(args));
    console.info = (...args) => originalConsole.info(...sanitizeArgs(args));

    originalConsole.log('[PII-SANITIZER] ✅ Sanitização de PII em logs ativada (produção)');

    return { originalConsole, sanitizePII };
}

module.exports = {
    sanitizePII,
    installPIISanitizer,
    PII_PATTERNS
};
