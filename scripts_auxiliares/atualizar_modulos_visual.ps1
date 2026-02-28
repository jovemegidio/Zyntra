# Script para Atualizar Módulos com Padrão PCP
# Este script cria backups e atualiza os módulos para seguir o padrão visual do PCP

$modulesPath = "c:\Users\egidioVLRNT\Documents\Sistema - Aluforce v.2 - BETA\modules"
$backupPath = "c:\Users\egidioVLRNT\Documents\Sistema - Aluforce v.2 - BETA\backup_modules_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

# Criar pasta de backup
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
Write-Host "Pasta de backup criada: $backupPath" -ForegroundColor Green

# Módulos para atualizar
$modules = @(
    @{
        Name = "NFe"
        File = "nfe.html"
        Color = "#1e40af"
        ColorSecondary = "#1e3a8a"
        Title = "NFe & Logística"
        Icon = "file-invoice"
    },
    @{
        Name = "Compras"
        File = "compras.html"
        Color = "#7c3aed"
        ColorSecondary = "#6d28d9"
        Title = "Gestão de Compras"
        Icon = "shopping-cart"
    },
    @{
        Name = "Financeiro"
        File = "financeiro.html"
        Color = "#10b981"
        ColorSecondary = "#059669"
        Title = "Sistema Financeiro"
        Icon = "dollar-sign"
    },
    @{
        Name = "Vendas"
        File = "index.html"
        Path = "public"
        Color = "#f59e0b"
        ColorSecondary = "#d97706"
        Title = "Sistema de Vendas"
        Icon = "chart-line"
    }
)

# Função para criar backup
function Backup-Module {
    param($moduleName, $fileName, $subPath = "")
    
    $sourcePath = if ($subPath) {
        Join-Path $modulesPath "$moduleName\$subPath\$fileName"
    } else {
        Join-Path $modulesPath "$moduleName\$fileName"
    }
    
    if (Test-Path $sourcePath) {
        $backupFile = Join-Path $backupPath "${moduleName}_${fileName}.backup"
        Copy-Item $sourcePath $backupFile -Force
        Write-Host "  Backup criado: $moduleName/$fileName" -ForegroundColor Cyan
        return $true
    }
    return $false
}

# Fazer backup de todos os módulos
Write-Host "`nCriando backups dos modulos..." -ForegroundColor Yellow
foreach ($module in $modules) {
    $subPath = if ($module.Path) { $module.Path } else { "" }
    Backup-Module -moduleName $module.Name -fileName $module.File -subPath $subPath
}

Write-Host "`nBACKUPS CONCLUIDOS!" -ForegroundColor Green
Write-Host "`nLocalizacao dos backups: $backupPath" -ForegroundColor White
Write-Host "`nIMPORTANTE:" -ForegroundColor Yellow
Write-Host "Os backups foram criados. Agora você pode prosseguir com as atualizacoes manuais" -ForegroundColor White
Write-Host "ou usar o Copilot para aplicar as mudancas nos arquivos." -ForegroundColor White

Write-Host "`nModulos a serem atualizados:" -ForegroundColor Cyan
foreach ($module in $modules) {
    Write-Host "  $($module.Title) ($($module.Name)/$($module.File))" -ForegroundColor White
}

Write-Host "`nScript concluido!" -ForegroundColor Green
