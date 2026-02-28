# Script para corrigir encoding de arquivos HTML
# ALUFORCE ERP - Correção em lote
# Data: 2026-01-18

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " CORREÇÃO DE ENCODING - ALUFORCE ERP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Mapeamento de caracteres incorretos (UTF-8 mal interpretado como ISO-8859-1)
$replacements = @{
    'Ã¡' = 'á'
    'Ã©' = 'é'
    'Ã­' = 'í'
    'Ã³' = 'ó'
    'Ãº' = 'ú'
    'Ã¢' = 'â'
    'Ãª' = 'ê'
    'Ã®' = 'î'
    'Ã´' = 'ô'
    'Ã»' = 'û'
    'Ã£' = 'ã'
    'Ãµ' = 'õ'
    'Ã§' = 'ç'
    'Ã€' = 'À'
    'Ã‰' = 'É'
    'Ã' = 'Í'
    'Ã"' = 'Ó'
    'Ãš' = 'Ú'
    'Ã‚' = 'Â'
    'ÃŠ' = 'Ê'
    'ÃŽ' = 'Î'
    'Ã"' = 'Ô'
    'Ã›' = 'Û'
    'Ãƒ' = 'Ã'
    'Ã•' = 'Õ'
    'Ã‡' = 'Ç'
    'Ã¼' = 'ü'
    'Ã¤' = 'ä'
    'Ã¶' = 'ö'
    'Ã ' = 'à'
    'Ã¨' = 'è'
    'Ã¬' = 'ì'
    'Ã²' = 'ò'
    'Ã¹' = 'ù'
    'âˆ'' = '−'
    'â€"' = '–'
    'â€"' = '—'
    'â€™' = '''
    'â€˜' = '''
    'â€œ' = '"'
    'â€' = '"'
    'â€¢' = '•'
    'â€¦' = '…'
    'Â ' = ' '
    'Â°' = '°'
    'Â²' = '²'
    'Â³' = '³'
    'Â½' = '½'
    'Â¼' = '¼'
    'Â¾' = '¾'
}

$basePath = "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2"
$excludePaths = @('node_modules', 'backups', '_archive', 'dist-electron')

# Encontrar arquivos HTML com encoding incorreto
Write-Host "`nBuscando arquivos HTML com encoding incorreto..." -ForegroundColor Yellow

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
        $originalContent = $content
        $needsFix = $false
        
        # Verificar se precisa correção
        foreach ($key in $replacements.Keys) {
            if ($content -match [regex]::Escape($key)) {
                $needsFix = $true
                break
            }
        }
        
        if ($needsFix) {
            # Aplicar correções
            foreach ($key in $replacements.Keys) {
                $content = $content -replace [regex]::Escape($key), $replacements[$key]
            }
            
            # Salvar arquivo corrigido em UTF-8
            $content | Set-Content $file.FullName -Encoding UTF8 -NoNewline
            $fixedCount++
            Write-Host "✅ Corrigido: $($file.Name)" -ForegroundColor Green
        }
    } catch {
        $errorCount++
        Write-Host "❌ Erro em: $($file.FullName) - $_" -ForegroundColor Red
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " RESULTADO DA CORREÇÃO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Arquivos verificados: $totalFiles" -ForegroundColor White
Write-Host "Arquivos corrigidos:  $fixedCount" -ForegroundColor Green
Write-Host "Erros:                $errorCount" -ForegroundColor Red
Write-Host "`nConcluído!" -ForegroundColor Cyan
