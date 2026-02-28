# Script para configurar favicon em todos os arquivos HTML
# Aluforce v.2 - 25/11/2025

$ErrorActionPreference = "Stop"

# Caminho base do sistema
$baseDir = "C:\Users\Administrator\Documents\Sistema - Aluforce v.2 - BETA"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   CONFIGURADOR DE FAVICON GLOBAL" -ForegroundColor Cyan
Write-Host "   Aluforce v.2 - Sistema Integrado" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Mapeamento de caminhos relativos para cada módulo/pasta
$faviconPaths = @{
    # Módulos principais (nível 1)
    "modules\PCP" = "Favicon Aluforce.png"
    "modules\NFe" = "Favicon Aluforce.png"
    "modules\RH" = "Favicon Aluforce.png"
    "modules\Compras" = "../PCP/Favicon Aluforce.png"
    "modules\Vendas" = "../PCP/Favicon Aluforce.png"
    "modules\Financeiro" = "../PCP/Favicon Aluforce.png"
    "modules\Estoque" = "../PCP/Favicon Aluforce.png"
    "modules\TI" = "../PCP/Favicon Aluforce.png"
    
    # Páginas públicas dos módulos (nível 2)
    "modules\RH\public" = "../Favicon Aluforce.png"
    "modules\Vendas\public" = "../../PCP/Favicon Aluforce.png"
    "modules\NFe\public" = "../Favicon Aluforce.png"
    
    # Vendas admin (nível 3)
    "modules\Vendas\public\admin" = "../../../PCP/Favicon Aluforce.png"
    
    # Raiz do sistema
    "public" = "../modules/PCP/Favicon Aluforce.png"
    "" = "modules/PCP/Favicon Aluforce.png" # launcher-automatico.html
}

# Contador de arquivos processados
$totalProcessed = 0
$totalUpdated = 0
$totalAlreadyOk = 0
$errors = @()

# Função para processar arquivo HTML
function Update-FaviconInHTML {
    param(
        [string]$FilePath,
        [string]$FaviconPath
    )
    
    try {
        $content = Get-Content $FilePath -Raw -Encoding UTF8
        
        # Verificar se já tem favicon correto (pattern simples)
        $escapedPath = [regex]::Escape($FaviconPath)
        if ($content -match "href=[`"`']$escapedPath[`"`']") {
            Write-Host "  ✓ Já configurado: $($FilePath.Replace($baseDir, ''))" -ForegroundColor Green
            return "ok"
        }
        
        # Remover favicons existentes (pattern simples)
        $content = $content -replace '<link[^>]*rel=["\x27]icon["\x27][^>]*>', ''
        
        # Criar tag de favicon
        $faviconTag = "    <link rel=`"icon`" href=`"$FaviconPath`">"
        
        # Encontrar posição para inserir (após <title> ou no <head>)
        if ($content -match '(<title>.*?</title>)') {
            $content = $content -replace '(<title>.*?</title>)', "`$1`r`n$faviconTag"
        }
        elseif ($content -match '(<head[^>]*>)') {
            $content = $content -replace '(<head[^>]*>)', "`$1`r`n$faviconTag"
        }
        else {
            Write-Host "  ⚠ Sem <head> ou <title>: $($FilePath.Replace($baseDir, ''))" -ForegroundColor Yellow
            return "skip"
        }
        
        # Salvar arquivo
        $content | Set-Content $FilePath -Encoding UTF8 -NoNewline
        Write-Host "  ✓ Atualizado: $($FilePath.Replace($baseDir, ''))" -ForegroundColor Cyan
        return "updated"
    }
    catch {
        Write-Host "  ✗ Erro: $($FilePath.Replace($baseDir, ''))" -ForegroundColor Red
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
        return "error"
    }
}

# Processar cada pasta
foreach ($folder in $faviconPaths.Keys) {
    $fullPath = if ($folder -eq "") { $baseDir } else { Join-Path $baseDir $folder }
    $faviconPath = $faviconPaths[$folder]
    
    Write-Host "`n📁 Processando: $folder" -ForegroundColor Yellow
    Write-Host "   Favicon: $faviconPath" -ForegroundColor Gray
    
    # Buscar todos os HTML na pasta
    $htmlFiles = Get-ChildItem -Path $fullPath -Filter "*.html" -File -ErrorAction SilentlyContinue
    
    if ($htmlFiles.Count -eq 0) {
        Write-Host "   Nenhum arquivo HTML encontrado" -ForegroundColor Gray
        continue
    }
    
    foreach ($file in $htmlFiles) {
        $result = Update-FaviconInHTML -FilePath $file.FullName -FaviconPath $faviconPath
        $totalProcessed++
        
        switch ($result) {
            "updated" { $totalUpdated++ }
            "ok" { $totalAlreadyOk++ }
            "error" { $errors += $file.FullName }
        }
    }
}

# Resumo final
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   RESUMO DA CONFIGURAÇÃO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total de arquivos processados: $totalProcessed" -ForegroundColor White
Write-Host "✓ Atualizados: $totalUpdated" -ForegroundColor Green
Write-Host "✓ Já configurados: $totalAlreadyOk" -ForegroundColor Green
Write-Host "✗ Erros: $($errors.Count)" -ForegroundColor $(if ($errors.Count -eq 0) { "Green" } else { "Red" })

if ($errors.Count -gt 0) {
    Write-Host "`n⚠ Arquivos com erro:" -ForegroundColor Yellow
    $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

Write-Host "`n✅ Configuração concluída!" -ForegroundColor Green
Write-Host ""
