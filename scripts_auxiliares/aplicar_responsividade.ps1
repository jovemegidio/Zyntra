# Script para aplicar responsividade em todas as páginas HTML
# ALUFORCE - Sistema de Gestão

$basePath = "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2"
$cssLink = '<link rel="stylesheet" href="/css/responsive-global.css?v=20260107">'
$jsScript = '<script src="/js/mobile-menu.js?v=20260107"></script>'

$counter = 0
$updated = 0

# Processar todos os arquivos HTML nos módulos
Get-ChildItem -Path "$basePath\modules" -Recurse -Filter "*.html" | ForEach-Object {
    $counter++
    $file = $_
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $modified = $false
    
    # Verificar se já tem o CSS responsivo (evitar duplicação)
    if ($content -notmatch 'responsive-global\.css') {
        # Adicionar antes do </head>
        if ($content -match '</head>') {
            $content = $content -replace '</head>', "    $cssLink`n</head>"
            $modified = $true
        }
    }
    
    # Verificar se já tem o JS do menu mobile (evitar duplicação)
    if ($content -notmatch 'mobile-menu\.js') {
        # Adicionar antes do </body>
        if ($content -match '</body>') {
            $content = $content -replace '</body>', "    $jsScript`n</body>"
            $modified = $true
        }
    }
    
    # Salvar se foi modificado
    if ($modified) {
        Set-Content $file.FullName $content -Encoding UTF8 -NoNewline
        $updated++
        Write-Host "✅ $($file.Name)" -ForegroundColor Green
    }
}

# Processar páginas na raiz public
Get-ChildItem -Path "$basePath\public" -Filter "*.html" | ForEach-Object {
    $counter++
    $file = $_
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $modified = $false
    
    if ($content -notmatch 'responsive-global\.css') {
        if ($content -match '</head>') {
            $content = $content -replace '</head>', "    $cssLink`n</head>"
            $modified = $true
        }
    }
    
    if ($content -notmatch 'mobile-menu\.js') {
        if ($content -match '</body>') {
            $content = $content -replace '</body>', "    $jsScript`n</body>"
            $modified = $true
        }
    }
    
    if ($modified) {
        Set-Content $file.FullName $content -Encoding UTF8 -NoNewline
        $updated++
        Write-Host "✅ $($file.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Responsividade aplicada com sucesso!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Total de arquivos: $counter" -ForegroundColor White
Write-Host " Arquivos atualizados: $updated" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
