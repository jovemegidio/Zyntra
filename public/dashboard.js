/* ============================================
   ALUFORCE - Dashboard JavaScript
   Modern Interactive Dashboard v2.0
   ============================================ */

// Initialize Lucide Icons
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initializeDashboard();
});

// ============================================
// Dashboard Initialization
// ============================================
function initializeDashboard() {
    initSidebar();
    initTheme();
    initDateTime();
    initCharts();
    initCommandPalette();
    initUserMenu();
    initNotifications();
    loadUserData();
    loadDashboardData();
}

// ============================================
// Sidebar Management
// ============================================
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    
    // Toggle sidebar collapse
    sidebarToggle?.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
    
    // Mobile menu toggle
    mobileMenuBtn?.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
    });
    
    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 1024) {
            if (!sidebar.contains(e.target) && !mobileMenuBtn?.contains(e.target)) {
                sidebar.classList.remove('mobile-open');
            }
        }
    });
    
    // Restore sidebar state
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
}

// ============================================
// Theme Management
// ============================================
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');
    
    // Set initial theme
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    } else if (prefersDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        updateThemeIcon('dark');
    }
    
    themeToggle?.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

function updateThemeIcon(theme) {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        const iconName = theme === 'dark' ? 'sun' : 'moon';
        themeToggle.innerHTML = `<i data-lucide="${iconName}"></i>`;
        lucide.createIcons();
    }
}

// ============================================
// Date & Time Display
// ============================================
function initDateTime() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
}

function updateDateTime() {
    const now = new Date();
    
    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = now.toLocaleDateString('pt-BR', dateOptions);
    
    const timeStr = now.toLocaleTimeString('pt-BR', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const currentDate = document.getElementById('currentDate');
    const currentTime = document.getElementById('currentTime');
    
    if (currentDate) currentDate.textContent = dateStr;
    if (currentTime) currentTime.textContent = timeStr;
    
    // Update welcome message based on time
    updateGreeting(now.getHours());
}

function updateGreeting(hour) {
    const welcomeText = document.querySelector('.welcome-text h1');
    if (!welcomeText) return;
    
    let greeting = 'Bom dia';
    let emoji = '☀️';
    
    if (hour >= 12 && hour < 18) {
        greeting = 'Boa tarde';
        emoji = '🌤️';
    } else if (hour >= 18 || hour < 6) {
        greeting = 'Boa noite';
        emoji = '🌙';
    }
    
    const userName = document.getElementById('welcomeName')?.textContent || 'Administrador';
    welcomeText.innerHTML = `${greeting}, <span id="welcomeName">${userName}</span>! ${emoji}`;
}

// ============================================
// Charts Initialization
// ============================================
function initCharts() {
    initRevenueChart();
    initCategoryChart();
}

function initRevenueChart() {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    
    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['01', '05', '10', '15', '20', '25', '30'],
            datasets: [{
                label: 'Faturamento',
                data: [45000, 52000, 38000, 71000, 55000, 82000, 95000],
                borderColor: '#6366f1',
                backgroundColor: gradient,
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointBackgroundColor: '#6366f1',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#fff',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#94a3b8' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return 'R$ ' + context.parsed.y.toLocaleString('pt-BR');
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: textColor
                    }
                },
                y: {
                    grid: {
                        color: gridColor
                    },
                    ticks: {
                        color: textColor,
                        callback: function(value) {
                            return 'R$ ' + (value / 1000) + 'k';
                        }
                    }
                }
            }
        }
    });
}

function initCategoryChart() {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Cabos', 'Fios', 'Conectores', 'Outros'],
            datasets: [{
                data: [45, 30, 15, 10],
                backgroundColor: [
                    '#6366f1',
                    '#22c55e',
                    '#f59e0b',
                    '#94a3b8'
                ],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: isDark ? '#94a3b8' : '#64748b',
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#fff',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#94a3b8' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            return context.label + ': ' + context.parsed + '%';
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// Command Palette (Ctrl+K / Cmd+K)
// ============================================
function initCommandPalette() {
    const commandPalette = document.getElementById('commandPalette');
    const commandInput = document.getElementById('commandInput');
    const searchInput = document.querySelector('.search-input');
    
    // Open with Ctrl+K or Cmd+K
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            toggleCommandPalette();
        }
        
        if (e.key === 'Escape') {
            closeCommandPalette();
        }
    });
    
    // Open from search input click
    searchInput?.addEventListener('focus', () => {
        toggleCommandPalette();
    });
    
    // Close on overlay click
    commandPalette?.addEventListener('click', (e) => {
        if (e.target === commandPalette) {
            closeCommandPalette();
        }
    });
    
    // Filter results on input
    commandInput?.addEventListener('input', filterCommands);
}

function toggleCommandPalette() {
    const commandPalette = document.getElementById('commandPalette');
    const commandInput = document.getElementById('commandInput');
    
    commandPalette?.classList.toggle('active');
    
    if (commandPalette?.classList.contains('active')) {
        setTimeout(() => commandInput?.focus(), 100);
    }
}

function closeCommandPalette() {
    const commandPalette = document.getElementById('commandPalette');
    commandPalette?.classList.remove('active');
}

function filterCommands() {
    const input = document.getElementById('commandInput');
    const query = input?.value.toLowerCase() || '';
    const items = document.querySelectorAll('.command-item');
    
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? 'flex' : 'none';
    });
}

// ============================================
// User Menu
// ============================================
function initUserMenu() {
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userMenuDropdown = document.getElementById('userMenuDropdown');
    
    userMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenuDropdown?.classList.toggle('active');
    });
    
    // Close on outside click
    document.addEventListener('click', () => {
        userMenuDropdown?.classList.remove('active');
    });
}

// ============================================
// Notifications
// ============================================
function initNotifications() {
    const notificationBtn = document.getElementById('notificationBtn');
    const notificationPanel = document.getElementById('notificationPanel');
    const closeBtn = document.getElementById('closeNotificationPanel');
    
    notificationBtn?.addEventListener('click', () => {
        notificationPanel?.classList.toggle('active');
    });
    
    closeBtn?.addEventListener('click', () => {
        notificationPanel?.classList.remove('active');
    });
    
    // Mark all as read
    document.querySelector('.mark-all-read')?.addEventListener('click', () => {
        document.querySelectorAll('.notification-item.unread').forEach(item => {
            item.classList.remove('unread');
        });
        
        const badge = document.querySelector('.notification-badge');
        if (badge) badge.style.display = 'none';
    });
}

// ============================================
// User Data Loading
// ============================================
function loadUserData() {
    // Simulating user data - in production, fetch from API
    const userData = {
        name: 'Administrador',
        email: 'ti@aluforce.ind.br',
        role: 'TI',
        initials: 'TI'
    };
    
    // Try to get from localStorage or session
    try {
        const sessionUser = localStorage.getItem('usuario');
        if (sessionUser) {
            const user = JSON.parse(sessionUser);
            userData.name = user.nome || userData.name;
            userData.email = user.email || userData.email;
            userData.role = user.cargo || userData.role;
            userData.initials = getInitials(userData.name);
        }
    } catch (e) {
        console.log('Using default user data');
    }
    
    // Update UI
    document.getElementById('userName').textContent = userData.name;
    document.getElementById('userRole').textContent = userData.role;
    document.getElementById('userInitials').textContent = userData.initials;
    document.getElementById('welcomeName').textContent = userData.name.split(' ')[0];
}

function getInitials(name) {
    return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
}

// ============================================
// Dashboard Data Loading
// ============================================
async function loadDashboardData() {
    try {
        // Try to fetch real data from API
        const [faturamento, pedidos, clientes] = await Promise.all([
            fetchWithFallback('/api/dashboard/faturamento-hoje', { total: 45280 }),
            fetchWithFallback('/api/dashboard/pedidos-hoje', { count: 24 }),
            fetchWithFallback('/api/dashboard/novos-clientes', { count: 7 })
        ]);
        
        // Update KPIs
        animateValue('kpiFaturamento', 0, faturamento.total, 1500, (v) => 
            'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        );
        
        // Load recent orders
        loadRecentOrders();
        
    } catch (error) {
        console.log('Using cached dashboard data');
    }
}

async function fetchWithFallback(url, fallback) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('API Error');
        return await response.json();
    } catch {
        return fallback;
    }
}

function animateValue(elementId, start, end, duration, formatter) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const range = end - start;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease out cubic
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(start + (range * easeOut));
        
        element.textContent = formatter ? formatter(value) : value;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

async function loadRecentOrders() {
    try {
        const response = await fetch('/api/vendas/pedidos?limit=5&sort=id,desc');
        if (!response.ok) throw new Error('API Error');
        
        const data = await response.json();
        const ordersContainer = document.getElementById('recentOrdersList');
        
        if (!ordersContainer || !data.data?.length) return;
        
        ordersContainer.innerHTML = data.data.map(order => `
            <div class="order-item">
                <div class="order-info">
                    <span class="order-number">#${order.id}</span>
                    <span class="order-client">${order.cliente_razao_social || 'Cliente não informado'}</span>
                </div>
                <div class="order-details">
                    <span class="order-value">R$ ${parseFloat(order.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    <span class="order-status ${getStatusClass(order.status)}">${order.status || 'Pendente'}</span>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.log('Using sample orders data');
    }
}

function getStatusClass(status) {
    const statusMap = {
        'Aprovado': 'status-approved',
        'Em Análise': 'status-pending',
        'Produção': 'status-production',
        'Entregue': 'status-shipped',
        'Faturado': 'status-approved'
    };
    return statusMap[status] || 'status-pending';
}

// ============================================
// Quick Actions
// ============================================
document.querySelectorAll('.quick-action').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        
        switch (action) {
            case 'novo-pedido':
                window.location.href = '/Vendas/?novo=true';
                break;
            case 'novo-cliente':
                window.location.href = '/clientes/?novo=true';
                break;
            case 'emitir-nfe':
                window.location.href = '/nfe/?emitir=true';
                break;
            case 'relatorios':
                window.location.href = '/relatorios/';
                break;
        }
    });
});

// ============================================
// Period Change Handler
// ============================================
document.getElementById('chartPeriod')?.addEventListener('change', function() {
    const period = this.value;
    console.log('Changing period to:', period);
    // Reload chart data based on period
    // In production: fetch new data and update chart
});

// ============================================
// Window Resize Handler
// ============================================
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Redraw charts on resize
        Chart.helpers.each(Chart.instances, (instance) => {
            instance.resize();
        });
    }, 250);
});

// ============================================
// Service Worker Registration (PWA) - Movido para index.html
// ============================================
// SW agora é registrado no index.html para evitar conflitos

// ============================================
// Export Functions for External Use
// ============================================
window.AluForce = {
    refreshDashboard: loadDashboardData,
    toggleTheme: () => document.getElementById('themeToggle')?.click(),
    toggleSidebar: () => document.getElementById('sidebarToggle')?.click(),
    openCommandPalette: toggleCommandPalette
};

console.log('🚀 ALUFORCE Dashboard v2.0 initialized');
