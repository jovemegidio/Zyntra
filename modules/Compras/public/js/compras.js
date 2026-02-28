/* ========================================
   COMPRAS MODULE - MAIN NAVIGATION
   ======================================== */

class ComprasNavigation {
    constructor() {
        this.currentSection = 'dashboard-section';
        this.init();
    }

    init() {
        this.setupNavigation();
        this.setupUserMenu();
        this.loadUserInfo();
    }

    setupNavigation() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                if (link.getAttribute('href') === '/') {
                    return; // Allow navigation home
                }
                
                e.preventDefault();
                const btnId = link.id;
                
                // Update active state
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                
                this.switchSection(btnId);
            });
        });
    }

    switchSection(buttonId) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });

        // Show appropriate section
        switch(buttonId) {
            case 'btn-dashboard':
                document.getElementById('dashboard-section').classList.add('active');
                if (typeof renderDashboard === 'function') {
                    renderDashboard();
                }
                break;
            case 'btn-pedidos':
                document.getElementById('pedidos-section').classList.add('active');
                if (typeof pedidosCompras !== 'undefined') {
                    pedidosCompras.init();
                }
                break;
            case 'btn-cotacoes':
                document.getElementById('cotacoes-section').classList.add('active');
                if (typeof cotacoesCompras !== 'undefined') {
                    cotacoesCompras.init();
                }
                break;
            case 'btn-fornecedores':
                document.getElementById('fornecedores-section').classList.add('active');
                if (typeof fornecedoresCompras !== 'undefined') {
                    fornecedoresCompras.init();
                }
                break;
            case 'btn-materiais':
                document.getElementById('materiais-section').classList.add('active');
                if (typeof materiaisCompras !== 'undefined') {
                    materiaisCompras.init();
                }
                break;
            case 'btn-recebimento':
                document.getElementById('recebimento-section').classList.add('active');
                if (typeof recebimentoCompras !== 'undefined') {
                    recebimentoCompras.init();
                }
                break;
            case 'btn-estoque':
                document.getElementById('estoque-section').classList.add('active');
                if (typeof estoqueCompras !== 'undefined') {
                    estoqueCompras.init();
                }
                break;
            case 'btn-relatorios':
                document.getElementById('relatorios-section').classList.add('active');
                if (typeof relatoriosCompras !== 'undefined') {
                    relatoriosCompras.init();
                }
                break;
        }
    }

    setupUserMenu() {
        const userDropdownBtn = document.querySelector('.user-dropdown-btn');
        const userDropdown = document.querySelector('.user-dropdown');
        
        if (userDropdownBtn && userDropdown) {
            userDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle('active');
            });

            document.addEventListener('click', () => {
                userDropdown.classList.remove('active');
            });
        }

        // Logout
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('token');
                window.location.href = '/';
            });
        }
    }

    async loadUserInfo() {
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                window.location.href = '/';
                return;
            }

            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                const user = data.usuario;
                // Usar apelido se disponível, senão primeiro nome
                const primeiroNome = user.apelido || (user.nome ? user.nome.split(' ')[0] : 'Usuário');
                
                // Atualizar saudação dinmica baseada na hora
                const hour = new Date().getHours();
                let greeting = 'Bom dia';
                if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
                else if (hour >= 18 || hour < 5) greeting = 'Boa noite';
                
                const greetingTextEl = document.getElementById('greeting-text');
                if (greetingTextEl) greetingTextEl.textContent = greeting;
                
                const userNameEl = document.getElementById('user-name');
                if (userNameEl) userNameEl.textContent = primeiroNome;
            }
        } catch (error) {
            console.error('Erro ao carregar usuário:', error);
        }
    }
}

// Initialize
window.comprasNav = new ComprasNavigation();

// Auto-load dashboard on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof comprasDashboard !== 'undefined') {
            comprasDashboard.init();
        }
    });
} else {
    if (typeof comprasDashboard !== 'undefined') {
        comprasDashboard.init();
    }
}
