# Script para mover arquivos de teste para pasta segura
# Execucao: .\limpar-arquivos-teste.ps1

$baseDir = "C:\Users\Administrator\Documents\Sistema - Aluforce v.2 - BETA"
$safeDir = Join-Path $baseDir "_ARQUIVOS_DESENVOLVIMENTO_NAO_VERSIONAR"

Write-Host "Movendo arquivos de teste para pasta segura..." -ForegroundColor Cyan

# Criar pasta segura
if (-not (Test-Path $safeDir)) {
    New-Item -ItemType Directory -Path $safeDir -Force | Out-Null
}

# Criar subpastas
$subDirs = @("testes", "scripts", "credenciais", "relatorios", "backups", "temp")
foreach ($sub in $subDirs) {
    $path = Join-Path $safeDir $sub
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

$count = 0

# Mover arquivos de teste
Write-Host "Movendo arquivos de teste..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "teste_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "testes") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "test_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "testes") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "testar_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "testes") -Force
    $count++
}

# Mover scripts de debug
Write-Host "Movendo scripts de debug..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "debug_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "diagnostico*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "verificar_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}

# Mover credenciais
Write-Host "Movendo arquivos de credenciais..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "credenciais_*.txt" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "credenciais") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "credenciais_*.csv" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "credenciais") -Force
    $count++
}

# Mover scripts de setup
Write-Host "Movendo scripts de setup..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "setup_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "criar_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "atualizar_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "corrigir_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "fix_*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "fix_*.py" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}

# Mover analises
Write-Host "Movendo scripts de analise..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "analisar*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "comparar*.js" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "scripts") -Force
    $count++
}

# Mover relatorios
Write-Host "Movendo relatorios..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "RELATORIO_*.md" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "relatorios") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "RELATORIO_*.json" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "relatorios") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "ANALISE_*.md" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "relatorios") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "relatorio_*.json" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "relatorios") -Force
    $count++
}

# Mover backups
Write-Host "Movendo backups..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "*.backup-*" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "backups") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "server.js.before-*" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "backups") -Force
    $count++
}

# Mover arquivos Excel de teste
Write-Host "Movendo arquivos Excel de teste..." -ForegroundColor Yellow
Get-ChildItem -Path $baseDir -Filter "TESTE_*.xlsx" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "temp") -Force
    $count++
}
Get-ChildItem -Path $baseDir -Filter "*.xlsx.backup" | ForEach-Object {
    Move-Item $_.FullName -Destination (Join-Path $safeDir "temp") -Force
    $count++
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "CONCLUIDO! Arquivos movidos: $count" -ForegroundColor Green
Write-Host "Local: $safeDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
