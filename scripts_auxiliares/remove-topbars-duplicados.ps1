# Script para remover topbars duplicados do index.html do PCP
$filePath = "c:\Users\Administrator\Documents\Sistema - Aluforce v.2 - BETA\modules\PCP\index.html"

Write-Host "Lendo arquivo..." -ForegroundColor Yellow
$content = Get-Content $filePath -Raw

# Padrão para encontrar o topbar completo (da tag <header class="topbar"> até o </header> correspondente)
$pattern = '(?s)<header class="topbar">.*?</header>\s*\n\s*\n'

# Contar quantos existem
$matches = [regex]::Matches($content, $pattern)
Write-Host "Encontrados $($matches.Count) topbars" -ForegroundColor Cyan

if ($matches.Count -gt 1) {
    Write-Host "Mantendo apenas o primeiro topbar e removendo os outros..." -ForegroundColor Yellow
    
    # Manter o primeiro match
    $firstMatch = $matches[0].Value
    
    # Remover TODOS os matches
    $content = [regex]::Replace($content, $pattern, '')
    
    # Adicionar o primeiro topbar de volta após <body> e antes de <div class="container-principal">
    $content = $content -replace '(<body>\s*\n\s*<a href="#main-content"[^>]*>.*?</a>\s*\n\s*)\n\s*<div class="container-principal">', "`$1`n$firstMatch`n    <div class=""container-principal"">"
    
    # Salvar arquivo
    Write-Host "Salvando arquivo corrigido..." -ForegroundColor Yellow
    $content | Set-Content $filePath -NoNewline
    
    Write-Host "✅ Topbars duplicados removidos com sucesso!" -ForegroundColor Green
    
    # Verificar resultado
    $newContent = Get-Content $filePath -Raw
    $newMatches = [regex]::Matches($newContent, $pattern)
    Write-Host "Topbars restantes: $($newMatches.Count)" -ForegroundColor Cyan
} else {
    Write-Host "✅ Apenas 1 topbar encontrado, nada a fazer!" -ForegroundColor Green
}
