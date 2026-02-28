/* PCP Standard JavaScript - Funcionalidades Comuns para Todos os Módulos */

// ===== GERENCIAMENTO DE MODO ESCURO =====
function initDarkMode() {
    const darkModeToggle = document.getElementById('btn-dark-mode-toggle');
    const darkModeIcon = document.getElementById('dark-mode-icon');
    
    // Verificar preferência salva
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        if (darkModeIcon) {
            darkModeIcon.classList.remove('fa-moon');
            darkModeIcon.classList.add('fa-sun');
        }
    }
    
    // Toggle dark mode
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isNowDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('darkMode', isNowDark);
            
            if (darkModeIcon) {
                if (isNowDark) {
                    darkModeIcon.classList.remove('fa-moon');
                    darkModeIcon.classList.add('fa-sun');
                } else {
                    darkModeIcon.classList.remove('fa-sun');
                    darkModeIcon.classList.add('fa-moon');
                }
            }
        });
    }
}

// ===== GERENCIAMENTO DO MENU DE USUÁRIO =====
function toggleUserMenu() {
    const dropdown = document.getElementById('user-menu-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Fechar menu ao clicar fora
document.addEventListener('click', (e) => {
    const userMenu = document.querySelector('.user-menu');
    const dropdown = document.getElementById('user-menu-dropdown');
    
    if (dropdown && !userMenu.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

// ===== GERENCIAMENTO DA SIDEBAR MOBILE =====
function initSidebarMobile() {
    const menuToggle = document.querySelector('.menu-toggle-btn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (menuToggle && sidebar && overlay) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
        });
        
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
        });
    }
}

// ===== NAVEGAÇÍO DA SIDEBAR =====
function initSidebarNavigation() {
    const navLinks = document.querySelectorAll('.sidebar-nav a');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            
            // Se for navegação interna (hash)
            if (href && href.startsWith('#')) {
                e.preventDefault();
                
                // Remove active de todos
                navLinks.forEach(l => l.classList.remove('active'));
                
                // Adiciona active no clicado
                link.classList.add('active');
                
                // Scroll suave para a seção
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });
}

// ===== BOTÍO DE REFRESH =====
function initRefreshButton() {
    const refreshBtn = document.getElementById('btn-refresh-header');
    
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Animação de rotação
            const icon = refreshBtn.querySelector('i');
            if (icon) {
                icon.classList.add('fa-spin');
                
                setTimeout(() => {
                    icon.classList.remove('fa-spin');
                }, 1000);
            }
            
            // Recarregar dados (implementar em cada módulo)
            if (typeof refreshModuleData === 'function') {
                refreshModuleData();
            } else {
                location.reload();
            }
        });
    }
}

// ===== SISTEMA DE NOTIFICAÇÕES =====
function showNotification(message, type = 'info', duration = 3000) {
    const container = document.getElementById('notification-container') || createNotificationContainer();
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas ${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    container.appendChild(notification);
    
    // Animação de entrada
    setTimeout(() => notification.classList.add('show'), 10);
    
    // Remover automaticamente
    if (duration > 0) {
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-container';
    document.body.appendChild(container);
    return container;
}

function getNotificationIcon(type) {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    return icons[type] || icons.info;
}

// ===== LOADING SPINNER =====
function showLoading(targetElement) {
    if (typeof targetElement === 'string') {
        targetElement = document.getElementById(targetElement) || document.querySelector(targetElement);
    }
    
    if (targetElement) {
        targetElement.innerHTML = `
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Carregando...</p>
            </div>
        `;
    }
}

function hideLoading(targetElement) {
    if (typeof targetElement === 'string') {
        targetElement = document.getElementById(targetElement) || document.querySelector(targetElement);
    }
    
    if (targetElement) {
        const spinner = targetElement.querySelector('.loading-spinner');
        if (spinner) {
            spinner.remove();
        }
    }
}

// ===== FORMATAÇÍO DE DADOS =====
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function formatDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('pt-BR');
}

function formatDateTime(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleString('pt-BR');
}

function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(value);
}

// ===== VALIDAÇÍO DE FORMULÁRIOS =====
function validateForm(formId) {
    const form = document.getElementById(formId) || document.querySelector(formId);
    if (!form) return false;
    
    const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.classList.add('error');
            isValid = false;
        } else {
            input.classList.remove('error');
        }
    });
    
    return isValid;
}

// ===== REQUISIÇÕES API =====
async function apiRequest(endpoint, options = {}) {
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    };
    
    const config = { ...defaultOptions, ...options };
    
    // Adicionar token se existir
    const token = localStorage.getItem('authToken');
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    try {
        const response = await fetch(endpoint, config);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showNotification('Erro ao comunicar com o servidor', 'error');
        throw error;
    }
}

// ===== CONTROLE DE ABAS =====
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Remove active de todos os botões e conteúdos
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Adiciona active no botão clicado
            button.classList.add('active');
            
            // Mostra o conteúdo correspondente
            const targetContent = document.getElementById(`tab-${targetTab}`);
            if (targetContent) {
                targetContent.classList.add('active');
                
                // Callback para carregar dados da aba
                if (typeof loadTabData === 'function') {
                    loadTabData(targetTab);
                }
            }
        });
    });
}

// ===== BUSCA GLOBAL =====
function initGlobalSearch() {
    const searchInput = document.querySelector('.search-input');
    const searchResults = document.getElementById('search-inline-results');
    
    if (searchInput && searchResults) {
        let searchTimeout;
        
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            if (query.length < 2) {
                searchResults.innerHTML = '';
                searchResults.setAttribute('aria-hidden', 'true');
                return;
            }
            
            searchTimeout = setTimeout(() => {
                performSearch(query);
            }, 300);
        });
    }
}

async function performSearch(query) {
    // Implementar busca específica de cada módulo
    if (typeof moduleSearch === 'function') {
        await moduleSearch(query);
    }
}

// ===== CONFIRMAÇÍO DE AÇÕES =====
function confirmAction(message, onConfirm, onCancel) {
    if (confirm(message)) {
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    } else {
        if (typeof onCancel === 'function') {
            onCancel();
        }
    }
}

// ===== INICIALIZAÇÍO =====
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    initSidebarMobile();
    initSidebarNavigation();
    initRefreshButton();
    initTabs();
    initGlobalSearch();
    
    console.log('%c✅ PCP Standard JS inicializado com sucesso!', 'color: #10b981; font-weight: bold; font-size: 14px;');
});

// ===== EXPORTAR FUNÇÕES =====
window.PCPStandard = {
    showNotification,
    showLoading,
    hideLoading,
    formatCurrency,
    formatDate,
    formatDateTime,
    formatNumber,
    validateForm,
    apiRequest,
    confirmAction,
    toggleUserMenu
};
