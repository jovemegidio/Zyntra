# Script simplificado para configurar favicon
# Aluforce v.2 - 25/11/2025

param(
    [switch]$DryRun = $false
)

$baseDir = "C:\Users\Administrator\Documents\Sistema - Aluforce v.2 - BETA"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   CONFIGURADOR DE FAVICON GLOBAL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$stats = @{
    Processed = 0
    Updated = 0
    AlreadyOk = 0
    Errors = 0
}

function Update-Favicon {
    param($File, $FaviconPath)
    
    try {
        $content = Get-Content $File -Raw -Encoding UTF8
        $stats.Processed++
        
        # Verificar se já tem favicon
        if ($content -match "href=`"$([regex]::Escape($FaviconPath))`"") {
            Write-Host "  OK: $($File.Name)" -ForegroundColor Green
            $stats.AlreadyOk++
            return
        }
        
        # Remover favicon antigo
        $content = $content -replace '<link[^>]+rel="icon"[^>]*>', ''
        $content = $content -replace '<link[^>]+rel=''icon''[^>]*>', ''
        
        # Adicionar novo favicon após title
        $newTag = "`r`n    <link rel=`"icon`" href=`"$FaviconPath`">"
        
        if ($content -match '(<title>[^<]+</title>)') {
            $content = $content -replace '(<title>[^<]+</title>)', "`$1$newTag"
        }
        elseif ($content -match '(<head[^>]*>)') {
            $content = $content -replace '(<head[^>]*>)', "`$1$newTag"
        }
        else {
            Write-Host "  SKIP: $($File.Name) - sem head/title" -ForegroundColor Yellow
            return
        }
        
        if (-not $DryRun) {
            $content | Set-Content $File.FullName -Encoding UTF8 -NoNewline
        }
        
        Write-Host "  UPDATED: $($File.Name)" -ForegroundColor Cyan
        $stats.Updated++
    }
    catch {
        Write-Host "  ERROR: $($File.Name) - $($_.Exception.Message)" -ForegroundColor Red
        $stats.Errors++
    }
}

# Módulo PCP
Write-Host "`nModulo PCP:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\PCP\*.html" -File | ForEach-Object {
    Update-Favicon $_ "Favicon Aluforce.png"
}

# Módulo NFe
Write-Host "`nModulo NFe:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\NFe\*.html" -File | ForEach-Object {
    Update-Favicon $_ "Favicon Aluforce.png"
}

Write-Host "`nModulo NFe\public:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\NFe\public\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../Favicon Aluforce.png"
}

# Módulo RH
Write-Host "`nModulo RH:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\RH\*.html" -File | ForEach-Object {
    Update-Favicon $_ "Favicon Aluforce.png"
}

Write-Host "`nModulo RH\public:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\RH\public\*.html" -File | ForEach-Object {
    Update-Favicon $_ "../Favicon Aluforce.png"
}

# Módulo Vendas
Write-Host "`nModulo Vendas\public:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\Vendas\public\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../../PCP/Favicon Aluforce.png"
}

Write-Host "`nModulo Vendas\public\admin:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\Vendas\public\admin\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../../../PCP/Favicon Aluforce.png"
}

# Módulo Compras
Write-Host "`nModulo Compras:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\Compras\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../PCP/Favicon Aluforce.png"
}

# Módulo Financeiro
Write-Host "`nModulo Financeiro:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\Financeiro\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../PCP/Favicon Aluforce.png"
}

# Módulo Estoque
Write-Host "`nModulo Estoque:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\Estoque\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../PCP/Favicon Aluforce.png"
}

# Módulo TI
Write-Host "`nModulo TI:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\modules\TI\*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Update-Favicon $_ "../PCP/Favicon Aluforce.png"
}

# Pasta public raiz
Write-Host "`nPasta public:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\public\*.html" -File | ForEach-Object {
    Update-Favicon $_ "../modules/PCP/Favicon Aluforce.png"
}

# Arquivos na raiz
Write-Host "`nArquivos raiz:" -ForegroundColor Yellow
Get-ChildItem "$baseDir\*.html" -File | ForEach-Object {
    Update-Favicon $_ "modules/PCP/Favicon Aluforce.png"
}

# Resumo
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   RESUMO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Processados: $($stats.Processed)" -ForegroundColor White
Write-Host "Atualizados: $($stats.Updated)" -ForegroundColor Green
Write-Host "Ja configurados: $($stats.AlreadyOk)" -ForegroundColor Green
Write-Host "Erros: $($stats.Errors)" -ForegroundColor $(if ($stats.Errors -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($DryRun) {
    Write-Host "*** MODO DRY-RUN - Nenhuma alteracao foi feita ***" -ForegroundColor Yellow
}
else {
    Write-Host "Configuracao concluida!" -ForegroundColor Green
}
