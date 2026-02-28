# Script para corrigir encoding de arquivos HTML
# ALUFORCE ERP - Correcao em lote
# Data: 2026-01-18

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " CORRECAO DE ENCODING - ALUFORCE ERP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$basePath = "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2"
$excludePaths = @('node_modules', 'backups', '_archive', 'dist-electron')

# Encontrar arquivos HTML
Write-Host "`nBuscando arquivos HTML..." -ForegroundColor Yellow

$htmlFiles = Get-ChildItem -Path $basePath -Recurse -Filter "*.html" -File | Where-Object {
    $exclude = $false
    foreach ($excludePath in $excludePaths) {
        if ($_.FullName -like "*\$excludePath\*") {
            $exclude = $true
            break
        }
    }
    -not $exclude
}

$fixedCount = 0
$errorCount = 0
$totalFiles = $htmlFiles.Count

Write-Host "Encontrados $totalFiles arquivos HTML para verificar." -ForegroundColor White

foreach ($file in $htmlFiles) {
    try {
        $content = Get-Content $file.FullName -Raw -Encoding UTF8
        $needsFix = $content -match 'Ã©|Ã£|Ã§|Ã­|Ã¡|Ã³|Ãª|Ãº|Ãµ'
        
        if ($needsFix) {
            # Aplicar correcoes usando -replace
            $content = $content -replace 'Ã¡', [char]0x00E1  # a com acento
            $content = $content -replace 'Ã©', [char]0x00E9  # e com acento
            $content = $content -replace 'Ã­', [char]0x00ED  # i com acento
            $content = $content -replace 'Ã³', [char]0x00F3  # o com acento
            $content = $content -replace 'Ãº', [char]0x00FA  # u com acento
            $content = $content -replace 'Ã¢', [char]0x00E2  # a circunflexo
            $content = $content -replace 'Ãª', [char]0x00EA  # e circunflexo
            $content = $content -replace 'Ã®', [char]0x00EE  # i circunflexo
            $content = $content -replace 'Ã´', [char]0x00F4  # o circunflexo
            $content = $content -replace 'Ã»', [char]0x00FB  # u circunflexo
            $content = $content -replace 'Ã£', [char]0x00E3  # a til
            $content = $content -replace 'Ãµ', [char]0x00F5  # o til
            $content = $content -replace 'Ã§', [char]0x00E7  # c cedilha
            $content = $content -replace 'Ã ', [char]0x00E0  # a crase
            $content = $content -replace 'Ã¨', [char]0x00E8  # e crase
            $content = $content -replace 'Ã¬', [char]0x00EC  # i crase
            $content = $content -replace 'Ã²', [char]0x00F2  # o crase
            $content = $content -replace 'Ã¹', [char]0x00F9  # u crase
            $content = $content -replace 'Ã¼', [char]0x00FC  # u trema
            
            # Salvar arquivo corrigido em UTF-8
            [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.Encoding]::UTF8)
            $fixedCount++
        }
    } catch {
        $errorCount++
        Write-Host "Erro em: $($file.Name)" -ForegroundColor Red
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " RESULTADO DA CORRECAO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Arquivos verificados: $totalFiles" -ForegroundColor White
Write-Host "Arquivos corrigidos:  $fixedCount" -ForegroundColor Green
Write-Host "Erros:                $errorCount" -ForegroundColor Red
Write-Host "`nConcluido!" -ForegroundColor Cyan
