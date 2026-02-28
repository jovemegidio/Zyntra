// JavaScript compartilhado para cabeçalho padronizado - ALUFORCE

// Função para carregar informações do usuário
async function loadUserInfo() {
    try {
        const response = await fetch('/api/user/me');
        if (response.ok) {
            const user = await response.json();
            
            // Atualizar nome do usuário
            const userTextElement = document.querySelector('.user-text');
            if (userTextElement) {
                userTextElement.textContent = user.nome || user.email || 'Usuário';
            }
            
            // Atualizar avatar
            const avatarImg = document.querySelector('.avatar-circle img');
            if (avatarImg && user.avatar) {
                avatarImg.src = `/avatars/${user.avatar}`;
                avatarImg.onerror = function() {
                    this.src='/avatars/default.webp';
                };
            }
        } else {
            console.warn('Não foi possível carregar informações do usuário');
        }
    } catch (error) {
        console.error('Erro ao carregar informações do usuário:', error);
    }
}

// Função para alternar menu do usuário
function toggleUserMenu() {
    const dropdown = document.getElementById('user-menu-dropdown');
    if (dropdown) {
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
    }
}

// Função para alternar modo escuro
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    
    // Salvar preferência
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    
    // Atualizar ícone
    const icon = document.getElementById('dark-mode-icon');
    if (icon) {
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// Função para atualizar dados
function refreshData() {
    // Recarregar a página ou fazer refresh específico do módulo
    window.location.reload();
}

// Função para sair do sistema
async function logout() {
    try {
        const response = await fetch('/logout', { method: 'POST' });
        if (response.ok) {
            window.location.href = '/login.html';
        } else {
            alert('Erro ao fazer logout');
        }
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        // Forçar logout local
        window.location.href = '/login.html';
    }
}

// Inicialização quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', function() {
    // Carregar informações do usuário
    loadUserInfo();
    
    // Aplicar modo escuro salvo
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    if (savedDarkMode) {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('dark-mode-icon');
        if (icon) {
            icon.className = 'fas fa-sun';
        }
    }
    
    // Event listeners para botões do cabeçalho
    const darkModeBtn = document.getElementById('btn-dark-mode-toggle');
    if (darkModeBtn) {
        darkModeBtn.addEventListener('click', toggleDarkMode);
    }
    
    const refreshBtn = document.getElementById('btn-refresh-header');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshData);
    }
    
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logout();
        });
    }
    
    // Fechar dropdown quando clicar fora
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.user-menu')) {
            const dropdown = document.getElementById('user-menu-dropdown');
            if (dropdown) {
                dropdown.style.display = 'none';
            }
        }
    });
    
    // Busca em tempo real (se existir campo de busca)
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            const query = this.value.trim();
            
            if (query.length > 2) {
                searchTimeout = setTimeout(() => {
                    performSearch(query);
                }, 300);
            } else {
                hideSearchResults();
            }
        });
    }
});

// Função de busca (pode ser customizada por cada módulo)
function performSearch(query) {
    console.log('Buscando por:', query);
    // Implementação específica de cada módulo pode sobrescrever esta função
}

// Função para esconder resultados da busca
function hideSearchResults() {
    const resultsDiv = document.getElementById('search-inline-results');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }
}

// Função para mostrar notificação
function showNotification(message, type = 'info') {
    // Implementação simples de notificação
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        animation: slideIn 0.3s ease;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Exportar funções para uso global
window.loadUserInfo = loadUserInfo;
window.toggleUserMenu = toggleUserMenu;
window.toggleDarkMode = toggleDarkMode;
window.refreshData = refreshData;
window.logout = logout;
window.showNotification = showNotification;