// Sistema de Permissões por Usuário - Aluforce
// Define quais áreas cada usuário pode acessar

const userPermissions = {
    // ============ ADMINISTRAÇÁO / TI ============
    // Douglas, Andreia, TI, RH - Acesso geral a todas as áreas
    'douglas': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'andreia': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'ti': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'antonio': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    // Variações para Antônio (encoding diferente)
    'antônio': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'ant??nio': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'egidio': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'rh': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },

    // Fernando Kofugi - Administrador
    'fernando': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },

    // Junior (Eldir) - Administrador
    'junior': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'eldir': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },
    'adm': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },

    // Guilherme Bastos (compras@aluforce.ind.br)
    'compras': {
        areas: ['vendas', 'compras', 'pcp', 'financeiro'],
        rhType: 'funcionario',
        isAdmin: false
    },
    'guilherme.bastos': {
        areas: ['vendas', 'compras', 'pcp', 'financeiro'],
        rhType: 'funcionario',
        isAdmin: false
    },

    // Douglas (aluforce@aluforce.ind.br) - alias pelo email prefix
    'aluforce': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'],
        rhType: 'areaadm',
        isAdmin: true
    },

    // ============ FINANCEIRO ============
    // Hellen (financeiro2@aluforce.ind.br)
    'hellen': {
        areas: ['financeiro', 'rh'],
        rhType: 'funcionario',
        isAdmin: false
    },
    'hellen.nascimento': {
        areas: ['financeiro', 'rh'],
        rhType: 'funcionario',
        isAdmin: false
    },
    'helen': {
        areas: ['financeiro', 'rh'],
        rhType: 'funcionario',
        isAdmin: false
    },
    'financeiro2': {
        areas: ['financeiro', 'rh'],
        rhType: 'funcionario',
        isAdmin: false
    },
    // Tatiane (financeiro3@aluforce.ind.br)
    'tatiane': {
        areas: ['financeiro', 'rh'],
        rhType: 'funcionario',
        isAdmin: false
    },
    'financeiro3': {
        areas: ['financeiro', 'rh'],
        rhType: 'funcionario',
        isAdmin: false
    },

    // ============ CONTAS QA (Gerentes - Full Admin por Módulo) ============
    'qafinanceiro': { areas: ['financeiro', 'vendas', 'compras', 'nfe', 'rh'], rhType: 'areaadm', isAdmin: true },
    'qavendas': { areas: ['vendas', 'rh'], rhType: 'areaadm', isAdmin: true },
    'qapcp': { areas: ['pcp', 'rh'], rhType: 'areaadm', isAdmin: true },
    'qarh': { areas: ['rh'], rhType: 'areaadm', isAdmin: true },
    'qacompras': { areas: ['vendas', 'compras', 'pcp', 'financeiro'], rhType: 'areaadm', isAdmin: true },
    'qanfe': { areas: ['nfe', 'faturamento', 'rh'], rhType: 'areaadm', isAdmin: true },
    'qapainel': { areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'faturamento', 'ti'], rhType: 'areaadm', isAdmin: true },

    // ============ USUÁRIO DE TESTE ============
    'teste': {
        areas: ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras'],
        rhType: 'area'
    }
};

// Função para normalizar nomes (remover acentos e caracteres especiais)
function normalizeUserName(userName) {
    if (!userName) return '';
    return userName
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[?]/g, ''); // Remove caracteres de encoding incorreto
}

// Função para verificar se o usuário tem acesso a uma área específica
function hasAccess(userName, area) {
    if (!userName) return false;

    const userKey = userName.toLowerCase().trim();
    const normalizedKey = normalizeUserName(userName);

    // Tenta encontrar primeiro com o nome original
    let userPerms = userPermissions[userKey];

    // Se não encontrar, tenta com o nome normalizado (sem acentos)
    if (!userPerms && normalizedKey !== userKey) {
        userPerms = userPermissions[normalizedKey];
    }

    if (!userPerms) {
        // Usuários não listados têm acesso apenas ao RH (área básica)
        return area === 'rh';
    }

    return userPerms.areas.includes(area.toLowerCase());
}

// Função para obter o tipo de RH que o usuário deve acessar
function getRHType(userName) {
    if (!userName) return 'area';

    const userKey = userName.toLowerCase().trim();
    const normalizedKey = normalizeUserName(userName);

    let userPerms = userPermissions[userKey];
    if (!userPerms && normalizedKey !== userKey) {
        userPerms = userPermissions[normalizedKey];
    }

    return userPerms ? userPerms.rhType : 'area';
}

// Função para obter todas as áreas do usuário
function getUserAreas(userName) {
    if (!userName) return ['rh'];

    const userKey = userName.toLowerCase().trim();
    const normalizedKey = normalizeUserName(userName);

    let userPerms = userPermissions[userKey];
    if (!userPerms && normalizedKey !== userKey) {
        userPerms = userPermissions[normalizedKey];
    }

    return userPerms ? userPerms.areas : ['rh'];
}

// Função para verificar se o usuário é admin
function isAdmin(userName) {
    if (!userName) return false;

    const userKey = userName.toLowerCase().trim();
    const normalizedKey = normalizeUserName(userName);

    let userPerms = userPermissions[userKey];
    if (!userPerms && normalizedKey !== userKey) {
        userPerms = userPermissions[normalizedKey];
    }

    // Verifica se tem a flag isAdmin ou se está na lista de admins
    if (userPerms && userPerms.isAdmin) return true;

    const adminUsers = ['douglas', 'andreia', 'ti', 'rh', 'antonio', 'egidio', 'junior', 'eldir', 'adm', 'aluforce'];
    return adminUsers.includes(userKey) || adminUsers.includes(normalizedKey);
}

// Função para obter permissões específicas do Financeiro
function getFinanceiroPermissoes(userName) {
    if (!userName) return null;

    const userKey = userName.toLowerCase().trim();
    const normalizedKey = normalizeUserName(userName);

    // Admins têm acesso total
    if (isAdmin(userName)) {
        return {
            contasPagar: true,
            contasReceber: true,
            fluxoCaixa: true,
            bancos: true,
            conciliacao: true,
            relatorios: true,
            isAdmin: true
        };
    }

    let userPerms = userPermissions[userKey];
    if (!userPerms && normalizedKey !== userKey) {
        userPerms = userPermissions[normalizedKey];
    }

    // Se tem permissões específicas do financeiro
    if (userPerms && userPerms.financeiroPermissoes) {
        return userPerms.financeiroPermissoes;
    }

    // Se tem acesso ao financeiro mas sem permissões específicas, dar acesso total
    if (userPerms && userPerms.areas && userPerms.areas.includes('financeiro')) {
        return {
            contasPagar: true,
            contasReceber: true,
            fluxoCaixa: true,
            bancos: true,
            conciliacao: true,
            relatorios: true
        };
    }

    return null;
}

// Mapeamento de áreas para URLs
const areaURLs = {
    'pcp': '/modules/PCP/index.html',
    'vendas': '/modules/Vendas/index.html',
    'financeiro': '/modules/Financeiro/financeiro.html',
    'nfe': '/modules/NFe/nfe.html',
    'compras': '/modules/Compras/compras.html',
    'rh': '/modules/RH/area.html',
    'ti': '/TI/ti.html'
};

// Função para obter URL da área baseada no tipo de RH
function getAreaURL(area, userName) {
    if (area === 'rh') {
        const rhType = getRHType(userName);
        return rhType === 'areaadm' ? 'RH/areaadm.html' : 'RH/area.html';
    }

    return areaURLs[area] || '#';
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.UserPermissions = {
        hasAccess,
        getRHType,
        getUserAreas,
        isAdmin,
        getAreaURL,
        getFinanceiroPermissoes,
        userPermissions
    };
}

// Exportar para Node.js se aplicável
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        hasAccess,
        getRHType,
        getUserAreas,
        isAdmin,
        getAreaURL,
        getFinanceiroPermissoes,
        userPermissions
    };
}
