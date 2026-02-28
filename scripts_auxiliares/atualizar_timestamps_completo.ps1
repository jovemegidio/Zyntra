# Script para atualizar timestamps em todos os arquivos HTML
$newTimestamp = 1765417597

Write-Host "Atualizando timestamps para: $newTimestamp" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

# Buscar todos os arquivos HTML recursivamente
$htmlFiles = Get-ChildItem -Path . -Filter *.html -Recurse -File | Where-Object {
    $_.FullName -notlike "*node_modules*" -and
    $_.FullName -notlike "*exceljs*"
}

$updatedFiles = 0
$totalReplacements = 0

foreach ($file in $htmlFiles) {
    try {
        $content = Get-Content $file.FullName -Raw -Encoding UTF8
        $originalContent = $content
        $fileChanged = $false
        
        # Substituir todas as versões de chat-widget.js
        if ($content -match 'chat-widget\.js\?v=\d+') {
            $content = $content -replace 'chat-widget\.js\?v=\d+', "chat-widget.js?v=$newTimestamp"
            $fileChanged = $true
            $totalReplacements++
        }
        
        # Substituir todas as versões de style.css
        if ($content -match 'style\.css\?v=\d+') {
            $content = $content -replace 'style\.css\?v=\d+', "style.css?v=$newTimestamp"
            $fileChanged = $true
            $totalReplacements++
        }
        
        if ($fileChanged) {
            Set-Content $file.FullName -Value $content -Encoding UTF8 -NoNewline
            $updatedFiles++
            Write-Host "[OK] $($file.FullName -replace [regex]::Escape($PWD), '.')" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "[ERRO] $($file.FullName): $_" -ForegroundColor Red
    }
}

Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "Resumo:" -ForegroundColor Yellow
Write-Host "- Arquivos atualizados: $updatedFiles" -ForegroundColor Green
Write-Host "- Total de substituicoes: $totalReplacements" -ForegroundColor Green
Write-Host "- Novo timestamp: $newTimestamp" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
