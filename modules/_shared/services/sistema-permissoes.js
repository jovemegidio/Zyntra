/**
 * SISTEMA DE PERMISSÕES UNIFICADO
 * Controle de acesso granular para todos os módulos do ERP
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

class SistemaPermissoes {
    constructor() {
        // Definição de todos os módulos e suas permissões
        this.modulos = {
            'vendas': {
                nome: 'Vendas',
                permissoes: ['visualizar', 'criar', 'editar', 'excluir', 'aprovar', 'faturar', 'relatorios']
            },
            'compras': {
                nome: 'Compras',
                permissoes: ['visualizar', 'criar', 'editar', 'excluir', 'aprovar', 'receber', 'relatorios']
            },
            'financeiro': {
                nome: 'Financeiro',
                permissoes: ['visualizar', 'criar', 'editar', 'excluir', 'pagar', 'receber', 'conciliar', 'relatorios']
            },
            'pcp': {
                nome: 'PCP',
                permissoes: ['visualizar', 'criar', 'editar', 'excluir', 'apontar', 'estoque', 'relatorios']
            },
            'rh': {
                nome: 'RH',
                permissoes: ['visualizar', 'criar', 'editar', 'excluir', 'folha', 'ferias', 'ponto', 'relatorios']
            },
            'nfe': {
                nome: 'NF-e',
                permissoes: ['visualizar', 'emitir', 'cancelar', 'inutilizar', 'relatorios']
            },
            'faturamento': {
                nome: 'Faturamento',
                permissoes: ['visualizar', 'criar', 'editar', 'cancelar', 'relatorios']
            },
            'configuracoes': {
                nome: 'Configurações',
                permissoes: ['visualizar', 'editar', 'usuarios', 'backup']
            }
        };

        // Perfis predefinidos
        this.perfis = {
            'admin': {
                nome: 'Administrador',
                descricao: 'Acesso total ao sistema',
                permissoes: this.getTodasPermissoes()
            },
            'gerente': {
                nome: 'Gerente',
                descricao: 'Acesso amplo com aprovações',
                permissoes: {
                    'vendas': ['visualizar', 'criar', 'editar', 'aprovar', 'faturar', 'relatorios'],
                    'compras': ['visualizar', 'criar', 'editar', 'aprovar', 'relatorios'],
                    'financeiro': ['visualizar', 'relatorios'],
                    'pcp': ['visualizar', 'criar', 'editar', 'relatorios'],
                    'rh': ['visualizar', 'relatorios'],
                    'nfe': ['visualizar', 'relatorios'],
                    'faturamento': ['visualizar', 'criar', 'relatorios'],
                    'configuracoes': ['visualizar']
                }
            },
            'vendedor': {
                nome: 'Vendedor',
                descricao: 'Acesso ao módulo de vendas',
                permissoes: {
                    'vendas': ['visualizar', 'criar', 'editar'],
                    'pcp': ['visualizar'],
                    'nfe': ['visualizar'],
                    'faturamento': ['visualizar']
                }
            },
            'comprador': {
                nome: 'Comprador',
                descricao: 'Acesso ao módulo de compras',
                permissoes: {
                    'compras': ['visualizar', 'criar', 'editar', 'receber'],
                    'pcp': ['visualizar', 'estoque'],
                    'financeiro': ['visualizar']
                }
            },
            'financeiro': {
                nome: 'Financeiro',
                descricao: 'Acesso ao módulo financeiro',
                permissoes: {
                    'financeiro': ['visualizar', 'criar', 'editar', 'pagar', 'receber', 'conciliar', 'relatorios'],
                    'vendas': ['visualizar'],
                    'compras': ['visualizar'],
                    'nfe': ['visualizar', 'relatorios'],
                    'faturamento': ['visualizar', 'relatorios']
                }
            },
            'producao': {
                nome: 'Produção',
                descricao: 'Acesso ao PCP',
                permissoes: {
                    'pcp': ['visualizar', 'criar', 'editar', 'apontar', 'estoque'],
                    'vendas': ['visualizar'],
                    'compras': ['visualizar']
                }
            },
            'rh_analista': {
                nome: 'Analista de RH',
                descricao: 'Acesso ao módulo de RH',
                permissoes: {
                    'rh': ['visualizar', 'criar', 'editar', 'folha', 'ferias', 'ponto', 'relatorios']
                }
            },
            'operador': {
                nome: 'Operador',
                descricao: 'Acesso básico de visualização',
                permissoes: {
                    'vendas': ['visualizar'],
                    'compras': ['visualizar'],
                    'pcp': ['visualizar', 'apontar'],
                    'financeiro': ['visualizar']
                }
            },
            'funcionario': {
                nome: 'Funcionário',
                descricao: 'Acesso ao portal do funcionário',
                permissoes: {
                    'rh': ['visualizar'] // Apenas dados próprios
                }
            }
        };
    }

    /**
     * Retorna todas as permissões possíveis
     */
    getTodasPermissoes() {
        const todas = {};
        for (const [modulo, config] of Object.entries(this.modulos)) {
            todas[modulo] = [...config.permissoes];
        }
        return todas;
    }

    /**
     * Verifica se usuário tem permissão específica
     * @param {object} usuario - Objeto do usuário com permissoes
     * @param {string} modulo - Nome do módulo
     * @param {string} acao - Ação a ser verificada
     * @returns {boolean}
     */
    temPermissao(usuario, modulo, acao) {
        if (!usuario) return false;

        // Admin tem acesso total
        if (usuario.perfil === 'admin' || usuario.is_admin) {
            return true;
        }

        // Verificar permissões do usuário
        const permissoesUsuario = usuario.permissoes || this.getPermissoesPerfil(usuario.perfil);
        
        if (!permissoesUsuario || !permissoesUsuario[modulo]) {
            return false;
        }

        return permissoesUsuario[modulo].includes(acao);
    }

    /**
     * Retorna permissões de um perfil
     */
    getPermissoesPerfil(perfil) {
        return this.perfis[perfil]?.permissoes || {};
    }

    /**
     * Verifica se usuário pode acessar módulo
     */
    podeAcessarModulo(usuario, modulo) {
        return this.temPermissao(usuario, modulo, 'visualizar');
    }

    /**
     * Retorna lista de módulos acessíveis pelo usuário
     */
    getModulosAcessiveis(usuario) {
        const acessiveis = [];
        
        for (const modulo of Object.keys(this.modulos)) {
            if (this.podeAcessarModulo(usuario, modulo)) {
                acessiveis.push({
                    id: modulo,
                    nome: this.modulos[modulo].nome,
                    permissoes: this.getPermissoesModulo(usuario, modulo)
                });
            }
        }
        
        return acessiveis;
    }

    /**
     * Retorna permissões do usuário em um módulo específico
     */
    getPermissoesModulo(usuario, modulo) {
        if (usuario.perfil === 'admin' || usuario.is_admin) {
            return this.modulos[modulo]?.permissoes || [];
        }

        const permissoesUsuario = usuario.permissoes || this.getPermissoesPerfil(usuario.perfil);
        return permissoesUsuario[modulo] || [];
    }

    /**
     * Cria middleware de verificação de permissão para Express
     */
    middleware(modulo, acao) {
        return (req, res, next) => {
            const usuario = req.user || req.session?.user;
            
            if (!usuario) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Usuário não autenticado' 
                });
            }

            if (!this.temPermissao(usuario, modulo, acao)) {
                return res.status(403).json({ 
                    success: false, 
                    message: `Sem permissão para ${acao} em ${modulo}` 
                });
            }

            next();
        };
    }

    /**
     * Verifica múltiplas permissões (AND)
     */
    temTodasPermissoes(usuario, permissoes) {
        return permissoes.every(({ modulo, acao }) => 
            this.temPermissao(usuario, modulo, acao)
        );
    }

    /**
     * Verifica múltiplas permissões (OR)
     */
    temAlgumaPermissao(usuario, permissoes) {
        return permissoes.some(({ modulo, acao }) => 
            this.temPermissao(usuario, modulo, acao)
        );
    }

    /**
     * Serializa permissões do usuário para o frontend
     */
    serializarPermissoes(usuario) {
        const resultado = {
            perfil: usuario.perfil,
            is_admin: usuario.perfil === 'admin' || usuario.is_admin,
            modulos: {}
        };

        for (const modulo of Object.keys(this.modulos)) {
            resultado.modulos[modulo] = {
                acessivel: this.podeAcessarModulo(usuario, modulo),
                permissoes: this.getPermissoesModulo(usuario, modulo)
            };
        }

        return resultado;
    }

    /**
     * Mescla permissões customizadas com perfil base
     */
    mesclarPermissoes(perfilBase, permissoesCustom) {
        const base = this.getPermissoesPerfil(perfilBase);
        const resultado = { ...base };

        for (const [modulo, acoes] of Object.entries(permissoesCustom)) {
            if (!resultado[modulo]) {
                resultado[modulo] = [];
            }
            // Adicionar permissões extras sem duplicar
            resultado[modulo] = [...new Set([...resultado[modulo], ...acoes])];
        }

        return resultado;
    }

    /**
     * Lista todos os perfis disponíveis
     */
    listarPerfis() {
        return Object.entries(this.perfis).map(([id, config]) => ({
            id,
            nome: config.nome,
            descricao: config.descricao
        }));
    }

    /**
     * Lista todos os módulos e suas permissões possíveis
     */
    listarModulos() {
        return Object.entries(this.modulos).map(([id, config]) => ({
            id,
            nome: config.nome,
            permissoes: config.permissoes
        }));
    }
}

// Instncia singleton
const sistemaPermissoes = new SistemaPermissoes();

// Exportar para uso em Node.js e Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SistemaPermissoes, sistemaPermissoes };
}

if (typeof window !== 'undefined') {
    window.SistemaPermissoes = SistemaPermissoes;
    window.sistemaPermissoes = sistemaPermissoes;
}
