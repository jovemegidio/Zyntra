# Script PowerShell para atualizar todas as referências de Inter para Outfit
# Executa substituição em massa nos arquivos HTML e CSS

$basePath = "c:\Users\egidio\Documents\Sistema - ALUFORCE - V.2"

Write-Host "=== ATUALIZANDO FONTE INTER PARA OUTFIT ===" -ForegroundColor Cyan
Write-Host ""

# Arquivos a serem atualizados
$files = Get-ChildItem -Path $basePath -Recurse -Include *.html,*.css -File | Where-Object { 
    $_.FullName -notmatch "node_modules" -and 
    $_.FullName -notmatch "\.git"
}

$totalUpdated = 0
$totalFiles = 0

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    
    if ($content -and ($content -match "family=Inter" -or $content -match "family=Poppins" -or $content -match "'Inter'" -or $content -match "'Poppins'")) {
        $originalContent = $content
        
        # Substituir links do Google Fonts para Inter
        $content = $content -replace "family=Inter:wght@\d+;\d+;\d+;\d+;\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        $content = $content -replace "family=Inter:wght@\d+;\d+;\d+;\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        $content = $content -replace "family=Inter:wght@\d+;\d+;\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        $content = $content -replace "family=Inter:wght@\d+;\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        $content = $content -replace "family=Inter:wght@\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        
        # Substituir font-family CSS com Inter
        $content = $content -replace "'Inter',\s*-apple-system", "'Outfit', -apple-system"
        $content = $content -replace "'Inter',\s*sans-serif", "'Outfit', sans-serif"
        $content = $content -replace "'Inter'\s*,", "'Outfit',"
        
        # Substituir font-family CSS com Poppins
        $content = $content -replace "family=Poppins:wght@\d+;\d+;\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        $content = $content -replace "family=Poppins:wght@\d+;\d+;\d+;\d+", "family=Outfit:wght@300;400;500;600;700;800"
        $content = $content -replace "'Poppins',\s*-apple-system", "'Outfit', -apple-system"
        $content = $content -replace "'Poppins',\s*sans-serif", "'Outfit', sans-serif"
        $content = $content -replace "'Poppins'\s*,", "'Outfit',"
        
        if ($content -ne $originalContent) {
            Set-Content -Path $file.FullName -Value $content -Encoding UTF8 -NoNewline
            Write-Host "[OK] $($file.Name)" -ForegroundColor Green
            $totalUpdated++
        }
        $totalFiles++
    }
}

Write-Host ""
Write-Host "=== RESUMO ===" -ForegroundColor Cyan
Write-Host "Arquivos verificados: $totalFiles" -ForegroundColor Yellow
Write-Host "Arquivos atualizados: $totalUpdated" -ForegroundColor Green
Write-Host ""
Write-Host "Fonte Outfit aplicada com sucesso!" -ForegroundColor Cyan
