# ALUFORCE v2.0 - Script para Aplicar Layout Unificado
# Este script adiciona a referência ao aluforce-auto-layout.js em todas as páginas HTML dos módulos

$baseDir = "C:\Users\egidio\Music\Sistema - ALUFORCE - V.2\modules"
$scriptTag = '<script src="/modules/_shared/aluforce-auto-layout.js"></script>'

# Mapear módulos para seus diretórios
$moduleMap = @{
    "Compras" = "compras"
    "Vendas" = "vendas"
    "PCP" = "pcp"
    "Financeiro" = "financeiro"
    "RH" = "rh"
    "NFe" = "nfe"
}

# Contadores
$updated = 0
$skipped = 0
$errors = 0

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ALUFORCE - Aplicando Layout Unificado" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Buscar todos os arquivos HTML
$htmlFiles = Get-ChildItem $baseDir -Recurse -Include "*.html" | Where-Object { 
    $_.FullName -notmatch "node_modules|backup|_shared|demo" 
}

Write-Host "Encontradas $($htmlFiles.Count) páginas HTML para processar..." -ForegroundColor Yellow
Write-Host ""

foreach ($file in $htmlFiles) {
    try {
        $content = Get-Content $file.FullName -Raw -Encoding UTF8
        
        # Verificar se já tem o script
        if ($content -match "aluforce-auto-layout\.js") {
            Write-Host "[SKIP] $($file.Name) - Já possui o layout" -ForegroundColor Gray
            $skipped++
            continue
        }
        
        # Determinar o módulo baseado no path
        $moduleName = ""
        foreach ($key in $moduleMap.Keys) {
            if ($file.FullName -match "\\$key\\") {
                $moduleName = $moduleMap[$key]
                break
            }
        }
        
        if (-not $moduleName) {
            Write-Host "[SKIP] $($file.Name) - Módulo não identificado" -ForegroundColor Gray
            $skipped++
            continue
        }
        
        # Criar tag com módulo
        $newScriptTag = "<script src=`"/modules/_shared/aluforce-auto-layout.js`" data-module=`"$moduleName`"></script>"
        
        # Inserir antes de </body>
        if ($content -match "</body>") {
            $newContent = $content -replace "</body>", "$newScriptTag`n</body>"
            
            # Salvar arquivo
            Set-Content -Path $file.FullName -Value $newContent -Encoding UTF8 -NoNewline
            
            Write-Host "[OK] $($file.Name) - Layout aplicado (módulo: $moduleName)" -ForegroundColor Green
            $updated++
        } else {
            Write-Host "[WARN] $($file.Name) - Tag </body> não encontrada" -ForegroundColor Yellow
            $skipped++
        }
        
    } catch {
        Write-Host "[ERRO] $($file.Name) - $($_.Exception.Message)" -ForegroundColor Red
        $errors++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " RESUMO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Atualizadas: $updated" -ForegroundColor Green
Write-Host "Ignoradas:   $skipped" -ForegroundColor Gray
Write-Host "Erros:       $errors" -ForegroundColor Red
Write-Host ""
Write-Host "Pronto! Reinicie o servidor para ver as mudanças." -ForegroundColor Yellow
