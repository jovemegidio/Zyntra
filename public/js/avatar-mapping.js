// Sistema de Mapeamento de Avatares - Aluforce
// Este arquivo gerencia o mapeamento correto entre nomes de usuários e arquivos de avatar

// Mapeamento direto: primeiro nome do usuário -> arquivo de foto
const avatarMapping = {
    // Administradores
    'admin': 'admin.png',
    'douglas': 'admin.png',
    'andreia': 'admin.png',
    
    // Usuários específicos com fotos personalizadas
    'clemerson': 'Clemerson.webp',
    'isabela': 'Isabela.webp',
    'thaina': 'Thaina.webp',
    'thiago': 'Thiago.webp',
    'nicolas': 'NicolasDaniel.webp',
    'nicolasdaniel': 'NicolasDaniel.webp',
    'rh': 'RH.webp',
    
    // Usuários com avatares SVG
    'joao': 'joao.svg',
    'maria': 'maria.svg',
    
    // Consultoria Lumiere
    'mauricio': 'Mauricio.jpg',
    'mauricio.torrolho': 'Mauricio.jpg'
};

// Função principal para obter o avatar de um usuário
function getAvatarPath(user) {
    if (!user) return null;
    
    // Extrai o primeiro nome do usuário
    let firstName = '';
    if (user.nome) {
        firstName = user.nome.split(' ')[0].toLowerCase();
    } else if (user.email) {
        // Se não tem nome, usa parte do email
        firstName = user.email.split('@')[0].toLowerCase();
    }
    
    if (!firstName) return null;
    
    // Verifica se existe mapeamento direto
    if (avatarMapping[firstName]) {
        return `avatars/${avatarMapping[firstName]}`;
    }
    
    // Tenta formatos padrão baseado no primeiro nome
    const formats = ['jpg', 'png', 'svg'];
    for (const format of formats) {
        const path = `avatars/${firstName}.${format}`;
        // No frontend, tentaremos carregar e usar fallback se não existir
        return path;
    }
    
    return null;
}

// Função para obter avatares com fallback para iniciais
function getAvatarOrInitials(user) {
    const avatarPath = getAvatarPath(user);
    
    if (avatarPath) {
        return {
            type: 'image',
            src: avatarPath,
            fallback: getInitials(user)
        };
    }
    
    return {
        type: 'initials',
        text: getInitials(user)
    };
}

// Função para obter iniciais do usuário
function getInitials(user) {
    if (!user) return '?';
    
    let name = user.nome || user.email || '';
    if (name.includes('@')) {
        name = name.split('@')[0];
    }
    
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
        return parts[0].charAt(0).toUpperCase();
    } else {
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
}

// Função para renderizar avatar em um elemento DOM
function renderAvatar(element, user, size = '40px') {
    if (!element || !user) return;
    
    const avatar = getAvatarOrInitials(user);
    
    // Limpa o elemento
    element.innerHTML = '';
    element.style.width = size;
    element.style.height = size;
    element.style.borderRadius = '50%';
    element.style.display = 'flex';
    element.style.alignItems = 'center';
    element.style.justifyContent = 'center';
    element.style.overflow = 'hidden';
    
    if (avatar.type === 'image') {
        const img = document.createElement('img');
        img.src = avatar.src;
        img.alt = user.nome || 'Avatar';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        
        // Fallback para iniciais se a imagem não carregar
        img.onerror = function() {
            element.innerHTML = avatar.fallback;
            element.style.backgroundColor = '#007bff';
            element.style.color = 'white';
            element.style.fontSize = `${parseInt(size) * 0.4}px`;
            element.style.fontWeight = 'bold';
        };
        
        element.appendChild(img);
    } else {
        element.textContent = avatar.text;
        element.style.backgroundColor = '#007bff';
        element.style.color = 'white';
        element.style.fontSize = `${parseInt(size) * 0.4}px`;
        element.style.fontWeight = 'bold';
    }
}

// Exporta as funções para uso global
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = {
        getAvatarPath,
        getAvatarOrInitials,
        getInitials,
        renderAvatar,
        avatarMapping
    };
} else {
    // Browser environment
    window.AvatarMapping = {
        getAvatarPath,
        getAvatarOrInitials,
        getInitials,
        renderAvatar,
        avatarMapping
    };
}