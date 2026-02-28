# Script para adicionar fonte Outfit a todos os módulos exceto Vendas
# Aluforce V2.0

$baseDir = "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2\modules"

# Módulos para atualizar (exceto Vendas)
$modulos = @("Compras", "Financeiro", "NFe", "PCP", "RH", "Faturamento")

# Link da fonte Outfit
$outfitLink = '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">'

# CSS para aplicar a fonte
$outfitCSS = @'
    <style>
        /* Fonte Outfit Global */
        * {
            font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        }
    </style>
'@

$totalFiles = 0
$atualizados = 0
$jaTemOutfit = 0

foreach ($modulo in $modulos) {
    $moduloPath = Join-Path $baseDir $modulo
    
    if (-not (Test-Path $moduloPath)) {
        Write-Host "⚠️  Módulo não encontrado: $modulo" -ForegroundColor Yellow
        continue
    }
    
    # Buscar arquivos HTML (excluindo node_modules)
    $htmlFiles = Get-ChildItem -Path $moduloPath -Recurse -Filter "*.html" | 
                 Where-Object { $_.FullName -notlike "*node_modules*" -and 
                               $_.FullName -notlike "*coverage*" -and
                               $_.FullName -notlike "*screenshots*" }
    
    foreach ($file in $htmlFiles) {
        $totalFiles++
        $content = Get-Content $file.FullName -Raw -Encoding UTF8
        
        # Verificar se já tem Outfit
        if ($content -match "Outfit") {
            $jaTemOutfit++
            Write-Host "✓ Já tem Outfit: $($file.Name)" -ForegroundColor Gray
            continue
        }
        
        # Verificar se tem <head>
        if ($content -match "<head[^>]*>") {
            # Adicionar link do Outfit após <head>
            $newContent = $content -replace "(<head[^>]*>)", "`$1`n    $outfitLink$outfitCSS"
            
            # Salvar arquivo
            Set-Content -Path $file.FullName -Value $newContent -Encoding UTF8 -NoNewline
            $atualizados++
            Write-Host "✅ Atualizado: $($file.FullName)" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Sem <head>: $($file.Name)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Fonte Outfit aplicada!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Total de arquivos: $totalFiles"
Write-Host " Já tinham Outfit: $jaTemOutfit"
Write-Host " Atualizados: $atualizados"
Write-Host "========================================" -ForegroundColor Cyan
