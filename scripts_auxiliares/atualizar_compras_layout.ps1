# Script para atualizar o layout do módulo Compras
# Aplica o padrão do Financeiro (topbar + sidebar moderna)

$comprasPath = "C:\Users\egidio\Music\Sistema - ALUFORCE - V.2\modules\Compras"

# Arquivos para atualizar (exceto index.html que já foi atualizado)
$arquivos = @(
    "materiais.html",
    "cotacoes.html", 
    "pedidos.html",
    "fornecedores.html",
    "gestao-estoque.html",
    "requisicoes.html",
    "relatorios.html",
    "dashboard-executivo.html",
    "dashboard-pro.html",
    "otimizacao-estoque.html"
)

# Mapeamento de página ativa
$activePages = @{
    "materiais.html" = "Materiais"
    "cotacoes.html" = "Cotações"
    "pedidos.html" = "Pedidos"
    "fornecedores.html" = "Fornecedores"
    "gestao-estoque.html" = "Gestão de Estoque"
    "requisicoes.html" = "Requisições"
    "relatorios.html" = "Relatórios"
    "dashboard-executivo.html" = "Dashboard"
    "dashboard-pro.html" = "Dashboard"
    "otimizacao-estoque.html" = "Gestão de Estoque"
}

# Novo HEAD template
$newHead = @'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <title>Aluforce - {{TITLE}}</title>
    
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />
    
    <!-- CSS Compartilhado -->
    <link rel="stylesheet" href="../_shared/modern-saas.css?v=3.0" />
    <link rel="stylesheet" href="../PCP/pcp_modern_clean.css?v=15.0" />
    <link rel="stylesheet" href="/css/responsive-global.css?v=2026010601">
    <link rel="stylesheet" href="/css/notifications-panel.css?v=2026010601">
    
    <style>
        /* Cor primária cyan do Compras */
        :root {
            --cor-primaria: #38bdf8;
            --cor-primaria-hover: #0ea5e9;
            --cor-primaria-light: #e0f2fe;
        }
        
        .sidebar-nav a.active {
            background: linear-gradient(135deg, #38bdf8, #0ea5e9) !important;
        }
        
        .sidebar-nav a:hover { color: #38bdf8; }
        
        .topbar-right { display: flex; align-items: center; gap: 16px; }
        .notification-icons { display: flex; align-items: center; gap: 8px; position: relative; }
        .notification-icons .notification-btn { width: 40px; height: 40px; border: none; background: transparent; color: #64748b; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; position: relative; font-size: 18px; }
        .notification-icons .notification-btn:hover { background: #f1f5f9; color: #38bdf8; }
        .notification-icons .notification-badge { position: absolute; top: 4px; right: 4px; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 10px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
        .topbar-left { display: flex; align-items: center; gap: 16px; }
        .nav-icons { display: flex; align-items: center; gap: 8px; margin-right: 16px; }
        .nav-icon-btn { width: 36px; height: 36px; border: none; background: transparent; color: #64748b; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .nav-icon-btn:hover { background: #f1f5f9; color: #38bdf8; }
        .menu-toggle-btn { display: none; width: 40px; height: 40px; border: none; background: transparent; color: #64748b; border-radius: 8px; cursor: pointer; }
        .user-menu { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 6px 12px; border-radius: 10px; transition: background 0.2s; position: relative; }
        .user-menu:hover { background: #f1f5f9; }
        .user-menu .avatar-circle { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #38bdf8, #0ea5e9); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }
        .user-menu .avatar-circle img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .user-menu .avatar-circle .user-initial { color: white; font-weight: 600; font-size: 14px; }
        .user-text strong { color: #1a1a1a; font-weight: 600; }
        .user-menu-dropdown { position: fixed; top: auto; right: 16px; margin-top: 8px; background: white; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); min-width: 200px; z-index: 99999; display: none; overflow: hidden; }
        .user-menu-dropdown.show { display: block; }
        .user-menu-dropdown a { display: flex; align-items: center; padding: 12px 16px; color: #475569; text-decoration: none; font-size: 14px; transition: background 0.2s; }
        .user-menu-dropdown a:hover { background: #f8fafc; }
        .user-menu-dropdown a i { margin-right: 10px; color: #94a3b8; }
        .user-menu-dropdown hr { margin: 8px 0; border: none; border-top: 1px solid #e2e8f0; }
        @media (max-width: 768px) { .nav-icons { display: none; } .menu-toggle-btn { display: flex; } }
        
        .loader-wrapper { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: white; display: flex; align-items: center; justify-content: center; z-index: 99999; transition: opacity 0.3s, visibility 0.3s; }
        .loader-wrapper.hidden { opacity: 0; visibility: hidden; }
        .loader { width: 52px; height: 52px; border: 4px solid #e2e8f0; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
'@

# Template da Sidebar
function Get-SidebarHtml($activeItem) {
    $items = @(
        @{href="index.html"; icon="fa-chart-pie"; tooltip="Dashboard"; name="Dashboard"},
        @{href="materiais.html"; icon="fa-cubes"; tooltip="Materiais"; name="Materiais"},
        @{href="cotacoes.html"; icon="fa-tags"; tooltip="Cotações"; name="Cotações"},
        @{href="pedidos.html"; icon="fa-shopping-cart"; tooltip="Pedidos"; name="Pedidos"},
        @{href="fornecedores.html"; icon="fa-truck"; tooltip="Fornecedores"; name="Fornecedores"},
        @{href="gestao-estoque.html"; icon="fa-boxes"; tooltip="Gestão de Estoque"; name="Gestão de Estoque"},
        @{href="requisicoes.html"; icon="fa-clipboard-list"; tooltip="Requisições"; name="Requisições"},
        @{href="relatorios.html"; icon="fa-chart-bar"; tooltip="Relatórios"; name="Relatórios"},
        @{href="/"; icon="fa-home"; tooltip="Painel de Controle"; name="Painel de Controle"}
    )
    
    $sidebarItems = ""
    foreach ($item in $items) {
        $activeClass = if ($item.name -eq $activeItem) { " active" } else { "" }
        $sidebarItems += @"
                    <li>
                        <a href="$($item.href)" class="nav-link$activeClass" title="$($item.tooltip)">
                            <span class="nav-icon"><i class="fas $($item.icon)"></i></span>
                            <span class="nav-tooltip">$($item.tooltip)</span>
                        </a>
                    </li>

"@
    }
    
    return @"
        <!-- Sidebar padrão PCP -->
        <aside class="sidebar">
            <nav class="sidebar-nav">
                <ul>
$sidebarItems                </ul>
            </nav>
        </aside>
"@
}

# Template da Topbar
$topbar = @'
        <!-- Topbar padrão PCP -->
        <header class="topbar">
            <div class="topbar-left">
                <div class="logo-section" style="display: flex; align-items: center; gap: 12px;">
                    <img src="/images/Logo Monocromatico - Branco - Aluforce.png" alt="Aluforce" class="header-logo" style="height: 24px;" />
                    <span style="color: #8b8b9a; font-size: 14px;">|</span>
                    <span style="color: #8b8b9a; font-size: 14px; font-weight: 600;">Compras</span>
                </div>
            </div>
            
            <div class="topbar-center">
                <div class="nav-icons">
                    <button class="nav-icon-btn" title="Grid"><i class="fas fa-th"></i></button>
                    <button class="nav-icon-btn" title="Lista"><i class="fas fa-list"></i></button>
                    <button class="nav-icon-btn" title="Atualizar" onclick="location.reload()"><i class="fas fa-sync-alt"></i></button>
                </div>
                <div class="search-wrapper" role="search">
                    <i class="fas fa-search search-icon"></i>
                    <input id="main-search" type="search" placeholder="Buscar..." class="search-input" autocomplete="off" />
                </div>
                <button class="menu-toggle-btn" title="Menu"><i class="fas fa-bars"></i></button>
            </div>
            
            <div class="topbar-right">
                <div class="notification-icons">
                    <button class="notification-btn" title="Notificações" id="notification-bell">
                        <i class="fas fa-bell"></i>
                        <span class="notification-badge" id="notification-count">0</span>
                    </button>
                    <button class="notification-btn" title="Mensagens"><i class="fas fa-envelope"></i></button>
                    <button class="notification-btn" title="Configurações"><i class="fas fa-cog"></i></button>
                </div>
                
                <div class="user-menu" onclick="toggleUserMenu()">
                    <span class="user-text"><span id="greeting-text">Bom dia</span>, <strong id="userName">Carregando...</strong></span>
                    <div class="avatar-circle" id="userAvatar">
                        <img src="/avatars/default.webp" alt="Usuário" id="userPhoto" />
                        <span class="user-initial" id="userInitial" style="display: none;"></span>
                    </div>
                </div>
                
                <div class="user-menu-dropdown" id="user-menu-dropdown">
                    <div style="padding: 12px 0;">
                        <a href="#"><i class="fas fa-user"></i>Meu Perfil</a>
                        <a href="#"><i class="fas fa-cog"></i>Configurações</a>
                        <hr>
                        <a href="#" id="btn-logout" style="color: #ef4444;"><i class="fas fa-sign-out-alt"></i>Sair</a>
                    </div>
                </div>
            </div>
        </header>
'@

# Script JS para adicionar no final
$jsAddition = @'

    <script>
        // Toggle User Menu
        function toggleUserMenu() {
            const dropdown = document.getElementById('user-menu-dropdown');
            dropdown.classList.toggle('show');
        }
        
        document.addEventListener('click', function(e) {
            const userMenu = document.querySelector('.user-menu');
            const dropdown = document.getElementById('user-menu-dropdown');
            if (userMenu && dropdown && !userMenu.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });
        
        window.addEventListener('load', function() {
            const loader = document.getElementById('loader-wrapper');
            if (loader) setTimeout(() => loader.classList.add('hidden'), 500);
        });
    </script>
'@

Write-Host "Iniciando atualizacao do layout do modulo Compras..." -ForegroundColor Cyan
Write-Host ""

$sucessos = 0
$falhas = 0

foreach ($arquivo in $arquivos) {
    $filePath = Join-Path $comprasPath $arquivo
    
    if (-not (Test-Path $filePath)) {
        Write-Host "  [SKIP] $arquivo - Arquivo nao encontrado" -ForegroundColor Yellow
        continue
    }
    
    try {
        Write-Host "  Processando $arquivo..." -ForegroundColor Gray
        
        $content = Get-Content $filePath -Raw -Encoding UTF8
        
        # Determinar qual item deve estar ativo
        $activeItem = $activePages[$arquivo]
        if (-not $activeItem) { $activeItem = "Dashboard" }
        
        # Extrair o título da página
        $titleMatch = [regex]::Match($content, '<title>[^<]*-\s*([^<]+)</title>')
        $pageTitle = if ($titleMatch.Success) { $titleMatch.Groups[1].Value.Trim() } else { $activeItem }
        
        # Extrair conteúdo principal (entre </header> ou similar e </main> ou </body>)
        # Procurar pelo conteúdo após o header antigo
        $mainContentMatch = [regex]::Match($content, '(?s)<div class="page-content">(.+?)</div>\s*</main>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if (-not $mainContentMatch.Success) {
            $mainContentMatch = [regex]::Match($content, '(?s)<div class="content-area">(.+?)</div>\s*</main>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        }
        
        $mainContent = ""
        if ($mainContentMatch.Success) {
            $mainContent = $mainContentMatch.Groups[1].Value
        }
        
        # Extrair scripts existentes
        $scriptsMatch = [regex]::Matches($content, '(?s)<script[^>]*>.*?</script>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        $existingScripts = ($scriptsMatch | ForEach-Object { $_.Value }) -join "`n"
        
        # Montar novo HEAD com título
        $finalHead = $newHead.Replace("{{TITLE}}", $pageTitle)
        
        # Montar sidebar com item ativo
        $sidebar = Get-SidebarHtml $activeItem
        
        # Construir nova página
        $newContent = @"
$finalHead
    </style>
    <script src="/js/anti-copy-protection.js"></script>
    <link rel="stylesheet" href="/css/popup-confirmacao.css">
</head>
<body>
    <!-- Loader -->
    <div id="loader-wrapper" class="loader-wrapper">
        <div class="loader"></div>
    </div>
    
    <div class="container-principal">
$sidebar
        
$topbar
        
        <!-- Main Content -->
        <main class="main-content" id="main-content">
$mainContent
        </main>
    </div>
$jsAddition
$existingScripts
    
    <!-- Sistema de Chat e Suporte -->
    <script src="/js/chat-suporte-widgets.js?v=20260105"></script>
</body>
</html>
"@
        
        # Salvar arquivo
        Set-Content -Path $filePath -Value $newContent -Encoding UTF8 -Force
        
        Write-Host "  [OK] $arquivo atualizado com sucesso!" -ForegroundColor Green
        $sucessos++
        
    } catch {
        Write-Host "  [ERRO] $arquivo - $($_.Exception.Message)" -ForegroundColor Red
        $falhas++
    }
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Atualizacao concluida!" -ForegroundColor Cyan
Write-Host "  Sucesso: $sucessos arquivos" -ForegroundColor Green
Write-Host "  Falhas:  $falhas arquivos" -ForegroundColor $(if ($falhas -gt 0) { "Red" } else { "Gray" })
Write-Host "======================================" -ForegroundColor Cyan
