# Script para atualizar layout das páginas NFe (Estilo Vendas)
# Versão: 1.0

$nfePath = "c:\Users\Administrator\Pictures\v11.12\Sistema - Aluforce v.2 - BETA\modules\NFe"

# Páginas que precisam ser atualizadas
$paginas = @(
    "nfse.html",
    "danfe.html",
    "relatorios.html",
    "eventos.html",
    "logistica.html",
    "certificado.html",
    "inutilizacao.html"
)

# Template do novo header/sidebar (Estilo Vendas)
$novoLayoutInicio = @'
<body>
    <div class="app-container">
        <!-- Sidebar Lateral (Estilo Vendas) -->
        <aside class="sidebar" style="width: 56px; background: #1a1a2e; display: flex; flex-direction: column; align-items: center; padding: 12px 0; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100;">
            <a href="/dashboard" style="width: 36px; height: 36px; background: #8b5cf6; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; text-decoration: none;" title="Voltar ao Painel">
                <i class="fas fa-file-invoice" style="color: white; font-size: 18px;"></i>
            </a>
            
            <nav style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                <a href="index.html" class="sidebar-btn" title="Dashboard" style="width: 40px; height: 40px; background: transparent; color: #8b8b9a; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-chart-pie" style="font-size: 18px;"></i>
                </a>
                <a href="emitir.html" class="sidebar-btn" title="Emitir NFe" style="width: 40px; height: 40px; background: transparent; color: #8b8b9a; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-file-invoice" style="font-size: 18px;"></i>
                </a>
                <a href="consultar.html" class="sidebar-btn" title="Consultar NFe" style="width: 40px; height: 40px; background: transparent; color: #8b8b9a; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-search" style="font-size: 18px;"></i>
                </a>
                <a href="nfse.html" class="sidebar-btn ACTIVE_PLACEHOLDER" title="NFSe" style="width: 40px; height: 40px; background: ACTIVE_BG_PLACEHOLDER; color: ACTIVE_COLOR_PLACEHOLDER; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-file-contract" style="font-size: 18px;"></i>
                </a>
                <a href="danfe.html" class="sidebar-btn" title="DANFE" style="width: 40px; height: 40px; background: transparent; color: #8b8b9a; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-print" style="font-size: 18px;"></i>
                </a>
                <a href="relatorios.html" class="sidebar-btn" title="Relatórios" style="width: 40px; height: 40px; background: transparent; color: #8b8b9a; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-chart-bar" style="font-size: 18px;"></i>
                </a>
            </nav>

            <div style="margin-top: auto; display: flex; flex-direction: column; gap: 4px;">
                <a href="/dashboard" class="sidebar-btn" title="Voltar ao Painel" style="width: 40px; height: 40px; background: transparent; color: #8b8b9a; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                    <i class="fas fa-home" style="font-size: 18px;"></i>
                </a>
            </div>
        </aside>

        <main style="flex: 1; display: flex; flex-direction: column; margin-left: 56px;">
            <!-- Header (Estilo Vendas) -->
            <header style="height: 48px; background: #1a1a2e; display: flex; align-items: center; justify-content: space-between; padding: 0 16px;">
                <div style="display: flex; align-items: center; gap: 8px; color: white;">
                    <span style="font-size: 14px; font-weight: 600; color: #8b8b9a;">NFe & Logística</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button onclick="location.reload()" style="width: 36px; height: 36px; border: none; background: transparent; color: #8b8b9a; border-radius: 8px; cursor: pointer;" title="Atualizar">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button style="width: 36px; height: 36px; border: none; background: transparent; color: #8b8b9a; border-radius: 8px; cursor: pointer;" title="Notificações">
                        <i class="fas fa-bell"></i>
                    </button>
                    <div style="display: flex; align-items: center; gap: 12px; margin-left: 16px; color: #8b8b9a; font-size: 13px;">
                        <span>Olá, <strong style="color: white;" id="user-name">Usuário</strong></span>
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #7c3aed); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; font-weight: 600;">
                            <span id="user-initials">U</span>
                        </div>
                    </div>
                </div>
            </header>

            <!-- Conteúdo Principal -->
            <div class="content-area" style="flex: 1; padding: 24px; overflow-y: auto; background: #0f0f1a;">
'@

$novoLayoutFim = @'

            </div><!-- /.content-area -->
        </main>
    </div><!-- /.app-container -->

<!-- Chat Widget Padrão Omie -->
</body>
</html>
'@

Write-Host "Iniciando atualização das páginas NFe..." -ForegroundColor Cyan

foreach ($pagina in $paginas) {
    $filePath = Join-Path $nfePath $pagina
    
    if (Test-Path $filePath) {
        Write-Host "Processando: $pagina" -ForegroundColor Yellow
        
        # Criar backup
        $backupPath = "$filePath.backup-layout"
        Copy-Item $filePath $backupPath -Force
        Write-Host "  - Backup criado: $backupPath" -ForegroundColor Gray
        
        # Ler conteúdo
        $content = Get-Content $filePath -Raw -Encoding UTF8
        
        # Extrair o head
        if ($content -match '(<head[\s\S]*?</head>)') {
            $head = $matches[1]
        } else {
            Write-Host "  - ERRO: Não foi possível encontrar o <head>" -ForegroundColor Red
            continue
        }
        
        # Encontrar conteúdo após </header>
        if ($content -match '</header>\s*(<div class="content-wrapper">|<div class="container">|<section|<div class="dashboard)') {
            # Extrair o conteúdo principal
            $mainContentStart = $content.IndexOf('</header>') + 9
            $bodyEndIndex = $content.LastIndexOf('</body>')
            
            if ($bodyEndIndex -gt $mainContentStart) {
                $mainContent = $content.Substring($mainContentStart, $bodyEndIndex - $mainContentStart).Trim()
                
                # Remover fechamentos antigos
                $mainContent = $mainContent -replace '</div>\s*</main>\s*</div>\s*</div>$', ''
                $mainContent = $mainContent -replace '</div>\s*</div>\s*</main>\s*</div>$', ''
                
                # Construir novo HTML
                $layout = $novoLayoutInicio
                
                # Marcar página ativa na sidebar
                switch ($pagina) {
                    "nfse.html" { 
                        $layout = $layout -replace 'href="nfse.html" class="sidebar-btn ACTIVE_PLACEHOLDER"', 'href="nfse.html" class="sidebar-btn active"'
                        $layout = $layout -replace 'ACTIVE_BG_PLACEHOLDER', '#8b5cf6'
                        $layout = $layout -replace 'ACTIVE_COLOR_PLACEHOLDER', 'white'
                    }
                    "danfe.html" { 
                        $layout = $layout -replace 'href="danfe.html" class="sidebar-btn"', 'href="danfe.html" class="sidebar-btn active"'
                        $layout = $layout -replace 'href="danfe.html" class="sidebar-btn active" title="DANFE" style="width: 40px; height: 40px; background: transparent', 'href="danfe.html" class="sidebar-btn active" title="DANFE" style="width: 40px; height: 40px; background: #8b5cf6'
                        $layout = $layout -replace 'href="danfe.html" class="sidebar-btn active" title="DANFE" style="width: 40px; height: 40px; background: #8b5cf6; color: #8b8b9a', 'href="danfe.html" class="sidebar-btn active" title="DANFE" style="width: 40px; height: 40px; background: #8b5cf6; color: white'
                    }
                    "relatorios.html" { 
                        $layout = $layout -replace 'href="relatorios.html" class="sidebar-btn"', 'href="relatorios.html" class="sidebar-btn active"'
                        $layout = $layout -replace 'href="relatorios.html" class="sidebar-btn active" title="Relatórios" style="width: 40px; height: 40px; background: transparent', 'href="relatorios.html" class="sidebar-btn active" title="Relatórios" style="width: 40px; height: 40px; background: #8b5cf6'
                        $layout = $layout -replace 'href="relatorios.html" class="sidebar-btn active" title="Relatórios" style="width: 40px; height: 40px; background: #8b5cf6; color: #8b8b9a', 'href="relatorios.html" class="sidebar-btn active" title="Relatórios" style="width: 40px; height: 40px; background: #8b5cf6; color: white'
                    }
                }
                
                # Limpar placeholders não usados
                $layout = $layout -replace 'ACTIVE_PLACEHOLDER', ''
                $layout = $layout -replace 'ACTIVE_BG_PLACEHOLDER', 'transparent'
                $layout = $layout -replace 'ACTIVE_COLOR_PLACEHOLDER', '#8b8b9a'
                
                $newHtml = @"
<!DOCTYPE html>
<html lang="pt-BR">
$head
$layout
                $mainContent
$novoLayoutFim
"@
                
                # Salvar arquivo
                $newHtml | Out-File $filePath -Encoding UTF8 -NoNewline
                Write-Host "  - Página atualizada com sucesso!" -ForegroundColor Green
            } else {
                Write-Host "  - ERRO: Estrutura do arquivo inválida" -ForegroundColor Red
            }
        } else {
            Write-Host "  - AVISO: Estrutura não encontrada, pulando..." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Arquivo não encontrado: $pagina" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Atualização concluída!" -ForegroundColor Green
Write-Host "Backups criados com extensão .backup-layout" -ForegroundColor Cyan
