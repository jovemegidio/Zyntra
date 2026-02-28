/**
 * Script para atualizar as páginas do módulo NFe com o layout estilo Vendas
 */

const fs = require('fs');
const path = require('path');

const NFE_DIR = path.join(__dirname);

// Template da sidebar estilo Vendas
const sidebarTemplate = `
        <!-- Sidebar Lateral (Estilo Vendas) -->
        <aside class="sidebar">
            <a href="/dashboard" class="sidebar-logo" title="Voltar ao Painel">
                <i class="fas fa-file-invoice"></i>
            </a>
            
            <nav class="sidebar-nav">
                <a href="index.html" class="sidebar-btn {{ACTIVE_DASHBOARD}}" title="Dashboard">
                    <i class="fas fa-chart-pie"></i>
                </a>
                <a href="emitir.html" class="sidebar-btn {{ACTIVE_EMITIR}}" title="Emitir NFe">
                    <i class="fas fa-file-invoice"></i>
                </a>
                <a href="consultar.html" class="sidebar-btn {{ACTIVE_CONSULTAR}}" title="Consultar NFe">
                    <i class="fas fa-search"></i>
                </a>
                <a href="nfse.html" class="sidebar-btn {{ACTIVE_NFSE}}" title="NFSe - Serviços">
                    <i class="fas fa-file-contract"></i>
                </a>
                <a href="danfe.html" class="sidebar-btn {{ACTIVE_DANFE}}" title="Gerar DANFE">
                    <i class="fas fa-print"></i>
                </a>
                <a href="relatorios.html" class="sidebar-btn {{ACTIVE_RELATORIOS}}" title="Relatórios">
                    <i class="fas fa-chart-bar"></i>
                </a>
            </nav>

            <div class="sidebar-bottom">
                <a href="eventos.html" class="sidebar-btn {{ACTIVE_EVENTOS}}" title="Eventos">
                    <i class="fas fa-history"></i>
                </a>
                <a href="logistica.html" class="sidebar-btn {{ACTIVE_LOGISTICA}}" title="Logística">
                    <i class="fas fa-truck"></i>
                </a>
                <a href="/dashboard" class="sidebar-btn" title="Voltar ao Painel">
                    <i class="fas fa-home"></i>
                </a>
            </div>
        </aside>`;

// Template do header estilo Vendas
const headerTemplate = `
            <!-- Header (Estilo Vendas) -->
            <header class="header">
                <div class="header-left">
                    <div class="header-brand">
                        <img src="/images/Logo Monocromatico - Branco - Aluforce.png" alt="ALUFORCE" onerror="this.style.display='none'">
                        <span>|</span>
                        <span>NFe & Logística</span>
                    </div>
                </div>
                <div class="header-right">
                    <button class="header-btn" title="Atualizar" onclick="location.reload()">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="header-btn" title="Notificações">
                        <i class="fas fa-bell"></i>
                    </button>
                    <button class="header-btn" title="Configurações">
                        <i class="fas fa-cog"></i>
                    </button>
                    <div class="user-greeting">
                        <span>Olá, <strong id="user-name">Usuário</strong></span>
                        <div class="user-avatar" id="user-avatar">
                            <img src="" alt="" style="display: none;">
                            <span id="user-initials">U</span>
                        </div>
                    </div>
                </div>
            </header>`;

// CSS estilo Vendas para adicionar ao head
const vendasLayoutCSS = `
    <style>
        :root {
            --sidebar-width: 56px;
            --header-height: 48px;
            --primary-orange: #f97316;
            --primary-dark: #1a1a2e;
            --bg-gray: #f5f5f5;
            --border-color: #e5e5e5;
            --text-primary: #1a1a1a;
            --text-secondary: #666;
            --success-green: #22c55e;
            --warning-yellow: #eab308;
            --danger-red: #ef4444;
            --nfe-primary: #8b5cf6;
            --nfe-secondary: #7c3aed;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-gray);
            color: var(--text-primary);
        }

        .app-container { display: flex; min-height: 100vh; }

        .sidebar {
            width: var(--sidebar-width);
            background: var(--primary-dark);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 12px 0;
            z-index: 100;
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
        }

        .sidebar-logo {
            width: 36px;
            height: 36px;
            background: var(--nfe-primary);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            cursor: pointer;
            text-decoration: none;
        }

        .sidebar-logo i { color: white; font-size: 18px; }

        .sidebar-nav {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
        }

        .sidebar-btn {
            width: 40px;
            height: 40px;
            border: none;
            background: transparent;
            color: #8b8b9a;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            transition: all 0.2s;
            position: relative;
            text-decoration: none;
        }

        .sidebar-btn:hover { background: rgba(255, 255, 255, 0.1); color: white; }
        .sidebar-btn.active { background: var(--nfe-primary); color: white; }

        .sidebar-btn::after {
            content: attr(title);
            position: absolute;
            left: 50px;
            background: #333;
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
            z-index: 1000;
        }

        .sidebar-btn:hover::after { opacity: 1; }

        .sidebar-bottom {
            margin-top: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .main-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            margin-left: var(--sidebar-width);
        }

        .header {
            height: var(--header-height);
            background: var(--primary-dark);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
        }

        .header-left, .header-right { display: flex; align-items: center; gap: 8px; }
        .header-brand { display: flex; align-items: center; gap: 8px; color: white; }
        .header-brand img { height: 24px; }
        .header-brand span { font-size: 14px; font-weight: 600; color: #8b8b9a; }

        .header-btn {
            width: 36px;
            height: 36px;
            border: none;
            background: transparent;
            color: #8b8b9a;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.2s;
        }

        .header-btn:hover { background: rgba(255, 255, 255, 0.1); color: white; }

        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: linear-gradient(135deg, #8b5cf6, #7c3aed);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            margin-left: 8px;
            overflow: hidden;
        }

        .user-avatar img { width: 100%; height: 100%; object-fit: cover; }

        .user-greeting {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-left: 16px;
            color: #8b8b9a;
            font-size: 13px;
        }

        .user-greeting strong { color: white; }

        .page-content {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
        }
    </style>`;

// Páginas a serem atualizadas e seus identificadores ativos
const pages = [
    { file: 'emitir.html', active: 'EMITIR' },
    { file: 'consultar.html', active: 'CONSULTAR' },
    { file: 'nfse.html', active: 'NFSE' },
    { file: 'danfe.html', active: 'DANFE' },
    { file: 'relatorios.html', active: 'RELATORIOS' },
    { file: 'eventos.html', active: 'EVENTOS' },
    { file: 'logistica.html', active: 'LOGISTICA' },
    { file: 'certificado.html', active: '' },
    { file: 'inutilizacao.html', active: '' }
];

function getSidebarForPage(activePage) {
    let sidebar = sidebarTemplate;
    const activeKeys = ['DASHBOARD', 'EMITIR', 'CONSULTAR', 'NFSE', 'DANFE', 'RELATORIOS', 'EVENTOS', 'LOGISTICA'];
    
    activeKeys.forEach(key => {
        sidebar = sidebar.replace(`{{ACTIVE_${key}}}`, key === activePage ? 'active' : '');
    });
    
    return sidebar;
}

console.log('='.repeat(60));
console.log('Atualizador de Layout NFe para estilo Vendas');
console.log('='.repeat(60));

pages.forEach(page => {
    const filePath = path.join(NFE_DIR, page.file);
    
    if (!fs.existsSync(filePath)) {
        console.log(`[SKIP] ${page.file} - arquivo não encontrado`);
        return;
    }

    // Fazer backup
    const backupPath = filePath + '.backup-vendas-layout';
    fs.copyFileSync(filePath, backupPath);
    console.log(`[BACKUP] ${page.file} -> ${page.file}.backup-vendas-layout`);

    console.log(`[INFO] ${page.file} - Backup criado. Execute manualmente as atualizações conforme necessário.`);
});

console.log('='.repeat(60));
console.log('Backups criados. Edição manual das páginas pode ser necessária.');
console.log('='.repeat(60));
