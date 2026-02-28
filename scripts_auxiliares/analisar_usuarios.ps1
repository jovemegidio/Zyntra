$files = Get-ChildItem -Path "c:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules" -Recurse -Include "*.html" | Where-Object { 
    $_.FullName -notlike "*node_modules*" -and 
    $_.FullName -notlike "*screenshots*" -and
    $_.FullName -notlike "*mobile*" -and
    $_.FullName -notlike "*INSTRUCOES*" -and
    $_.FullName -notlike "*PATCH*" -and
    $_.FullName -notlike "*modal*" -and
    $_.FullName -notlike "*demonstracao*" -and
    $_.FullName -notlike "*diagnostico*" -and
    $_.FullName -notlike "*gerar_ordem*" -and
    $_.FullName -notlike "*limpar_cache*" -and
    $_.FullName -notlike "*login*" -and
    $_.FullName -notlike "*catalogo_*" -and
    $_.FullName -notlike "*_new*" -and
    $_.FullName -notlike "*reference*" -and
    $_.FullName -notlike "*sistema_*" -and
    $_.FullName -notlike "*preview*"
}

Write-Host "=== ARQUIVOS SEM CARREGAMENTO DINAMICO DE USUARIO ===" -ForegroundColor Yellow
Write-Host ""

foreach ($file in $files) { 
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    
    $temUsuarioEstatico = $content -match "Olá,?\s*Usuário|>Usuário<|Olá Usuário"
    $temCarregamento = $content -match "carregarUsuario|initUserHeader|user-loader\.js|carregarDadosUsuario|loadUserData|carregarNomeUsuario"
    
    if ($temUsuarioEstatico -and -not $temCarregamento) { 
        Write-Host "PROBLEMA: $($file.FullName)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== ARQUIVOS COM CARREGAMENTO DINAMICO (OK) ===" -ForegroundColor Green
Write-Host ""

foreach ($file in $files) { 
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    
    $temUsuarioEstatico = $content -match "Olá,?\s*Usuário|>Usuário<|Olá Usuário"
    $temCarregamento = $content -match "carregarUsuario|initUserHeader|user-loader\.js|carregarDadosUsuario|loadUserData|carregarNomeUsuario"
    
    if ($temUsuarioEstatico -and $temCarregamento) { 
        Write-Host "OK: $($file.FullName)" -ForegroundColor Green
    }
}
