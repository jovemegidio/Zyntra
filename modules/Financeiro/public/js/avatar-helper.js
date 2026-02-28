/**
 * Avatar Helper - Módulo Financeiro
 * Gerencia o carregamento de avatares de usuários
 */

// Mapeamento de avatares por nome de usuário/email
const avatarNameMap = {
    'clemerson': '/avatars/Clemerson.webp',
    'isabela': '/avatars/Isabela.webp',
    'thaina': '/avatars/Thaina.webp',
    'thiago': '/avatars/Thiago.webp',
    'nicolas': '/avatars/NicolasDaniel.webp',
    'nicolasdaniel': '/avatars/NicolasDaniel.webp',
    'rh': '/avatars/Rh.webp',
    'admin': '/avatars/admin.webp',
    'ti': '/avatars/TI.webp',
    'tialuforce': '/avatars/TI.webp',
    'antonio': '/avatars/Antonio.webp',
    'antônio': '/avatars/Antonio.webp',
    'andreia': '/avatars/Andreia.webp',
    'guilherme': '/avatars/Guilherme.webp',
    'marcelo': '/avatars/Marcelo.webp',
    'financeiro': '/avatars/Financeiro.webp',
    'douglas': '/avatars/Douglas.webp',
    'hellen': '/avatars/Hellen.webp',
    'helen': '/avatars/Hellen.webp'
};

/**
 * Obtém o caminho do avatar baseado no email ou nome
 */
function getAvatarFromEmail(email, nome) {
    if (!email && !nome) return null;
    
    // Tentar por email primeiro
    if (email) {
        const username = email.split('@')[0].split('.')[0].toLowerCase();
        if (avatarNameMap[username]) return avatarNameMap[username];
    }
    
    // Tentar pelo primeiro nome
    if (nome) {
        const firstName = nome.split(' ')[0].toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove acentos
        if (avatarNameMap[firstName]) return avatarNameMap[firstName];
        
        // Tentar nome original com acentos
        const firstNameOriginal = nome.split(' ')[0].toLowerCase();
        if (avatarNameMap[firstNameOriginal]) return avatarNameMap[firstNameOriginal];
    }
    
    return null;
}

/**
 * Carrega e exibe o avatar do usuário nos elementos da página
 * @param {Object} user - Objeto do usuário com nome, email e avatar
 * @param {Object} elements - Elementos da página { photo, initial, name }
 */
function carregarAvatarUsuario(user, elements = {}) {
    const { photo, initial, name } = elements;
    const nome = user.nome || user.name || user.apelido || 'Usuário';
    const primeiroNome = nome.split(' ')[0];
    const inicialNome = primeiroNome.charAt(0).toUpperCase();
    
    // Atualizar nome se elemento existe
    if (name) {
        if (typeof name === 'string') {
            const nameEl = document.getElementById(name);
            if (nameEl) nameEl.textContent = primeiroNome;
        } else {
            name.textContent = primeiroNome;
        }
    }
    
    // Determinar avatar a usar
    let avatarUrl = null;
    
    // 1. Verificar se usuário tem avatar definido e não é o default
    if (user.avatar && user.avatar !== '/avatars/default.webp') {
        avatarUrl = user.avatar;
    }
    // 2. Verificar foto
    else if (user.foto && user.foto !== '/avatars/default.webp') {
        avatarUrl = user.foto;
    }
    // 3. Tentar pelo mapeamento de email/nome
    else {
        avatarUrl = getAvatarFromEmail(user.email, nome);
    }
    
    // Obter elementos
    const photoEl = typeof photo === 'string' ? document.getElementById(photo) : photo;
    const initialEl = typeof initial === 'string' ? document.getElementById(initial) : initial;
    
    if (avatarUrl && photoEl) {
        photoEl.src = avatarUrl;
        photoEl.style.display = 'block';
        photoEl.onerror = function() {
            // Se falhar ao carregar, mostrar inicial
            this.style.display = 'none';
            if (initialEl) {
                initialEl.textContent = inicialNome;
                initialEl.style.display = 'flex';
            }
        };
        if (initialEl) initialEl.style.display = 'none';
    } else if (initialEl) {
        initialEl.textContent = inicialNome;
        initialEl.style.display = 'flex';
        if (photoEl) photoEl.style.display = 'none';
    }
}

/**
 * Função completa para carregar usuário logado e atualizar UI
 */
async function carregarUsuarioComAvatar(options = {}) {
    const {
        photoId = 'user-photo',
        initialId = 'user-initial',
        nameId = 'user-name',
        onSuccess = null,
        onError = null
    } = options;
    
    try {
        const response = await fetch('/api/me', { credentials: 'include' });
        if (response.ok) {
            const user = await response.json();
            
            carregarAvatarUsuario(user, {
                photo: photoId,
                initial: initialId,
                name: nameId
            });
            
            if (onSuccess) onSuccess(user);
            return user;
        }
    } catch (error) {
        console.error('Erro ao carregar usuário:', error);
        if (onError) onError(error);
    }
    return null;
}

// Exportar para uso global
window.AvatarHelper = {
    avatarNameMap,
    getAvatarFromEmail,
    carregarAvatarUsuario,
    carregarUsuarioComAvatar
};
