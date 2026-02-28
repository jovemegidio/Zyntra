# ===================================================================
# Script para Mover Arquivos de Teste e Scripts com Credenciais
# ===================================================================
# Este script move todos os arquivos de teste, debug e desenvolvimento
# para uma pasta segura fora do repositório Git
# ===================================================================

Write-Host "🔒 MOVENDO ARQUIVOS DE TESTE E SCRIPTS COM CREDENCIAIS" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Gray

$baseDir = $PSScriptRoot
$safeDir = Join-Path $baseDir "_ARQUIVOS_DESENVOLVIMENTO_NAO_VERSIONAR"

# Criar pasta segura se não existir
if (-not (Test-Path $safeDir)) {
    New-Item -ItemType Directory -Path $safeDir -Force | Out-Null
    Write-Host "✅ Pasta segura criada: $safeDir" -ForegroundColor Green
}

# Criar subpastas organizadas
$subDirs = @(
    "testes",
    "scripts_debug",
    "scripts_setup",
    "scripts_analise",
    "credenciais",
    "relatorios",
    "backups_codigo",
    "dumps_db",
    "temp_excel"
)

foreach ($subDir in $subDirs) {
    $path = Join-Path $safeDir $subDir
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

Write-Host "`n📦 Movendo arquivos..." -ForegroundColor Yellow

# Contadores
$movedCount = 0
$skippedCount = 0

# Função para mover arquivo com segurança
function Move-SafeFile {
    param($file, $destination)
    
    try {
        if (Test-Path $file) {
            $destPath = Join-Path $destination (Split-Path $file -Leaf)
            
            # Se já existir no destino, adicionar timestamp
            if (Test-Path $destPath) {
                $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
                $name = [System.IO.Path]::GetFileNameWithoutExtension($file)
                $ext = [System.IO.Path]::GetExtension($file)
                $destPath = Join-Path $destination "${name}_${timestamp}${ext}"
            }
            
            Move-Item -Path $file -Destination $destPath -Force
            $script:movedCount++
            Write-Host "  ✓ Movido: $(Split-Path $file -Leaf)" -ForegroundColor DarkGray
        }
    } catch {
        $script:skippedCount++
        Write-Host "  ⚠ Erro ao mover: $(Split-Path $file -Leaf)" -ForegroundColor Yellow
    }
}

# ===================================================================
# MOVENDO ARQUIVOS POR CATEGORIA
# ===================================================================

Write-Host "`n🔍 Arquivos de teste (teste_*.js, test_*.js)..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "teste_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "testes") }
Get-ChildItem -Path $baseDir -Filter "test_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "testes") }
Get-ChildItem -Path $baseDir -Filter "teste-*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "testes") }
Get-ChildItem -Path $baseDir -Filter "testar_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "testes") }
Get-ChildItem -Path $baseDir -Filter "testar-*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "testes") }
Get-ChildItem -Path $baseDir -Filter "executar-*.html" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "testes") }

Write-Host "`n🐛 Scripts de debug..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "debug_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_debug") }
Get-ChildItem -Path $baseDir -Filter "debug-*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_debug") }
Get-ChildItem -Path $baseDir -Filter "diagnostico*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_debug") }
Get-ChildItem -Path $baseDir -Filter "descobrir_senha.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_debug") }
Get-ChildItem -Path $baseDir -Filter "investigar*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_debug") }

Write-Host "`n🔧 Scripts de setup e correção..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "setup_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "setup-*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "criar_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "atualizar_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "corrigir_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "correcao-*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "fix_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "fix_*.py" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "fix-*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }
Get-ChildItem -Path $baseDir -Filter "reset_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_setup") }

Write-Host "`n📊 Scripts de análise..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "analisar*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_analise") }
Get-ChildItem -Path $baseDir -Filter "comparar*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_analise") }
Get-ChildItem -Path $baseDir -Filter "validar*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_analise") }
Get-ChildItem -Path $baseDir -Filter "verificar*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_analise") }
Get-ChildItem -Path $baseDir -Filter "auditoria*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_analise") }
Get-ChildItem -Path $baseDir -Filter "check_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "scripts_analise") }

Write-Host "`n🔐 Arquivos de credenciais..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "credenciais_*.txt" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "credenciais") }
Get-ChildItem -Path $baseDir -Filter "credenciais_*.csv" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "credenciais") }
Get-ChildItem -Path $baseDir -Filter "exportar_credenciais.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "credenciais") }
Get-ChildItem -Path $baseDir -Filter "sincronizar_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "credenciais") }

Write-Host "`n📋 Relatórios e logs..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "RELATORIO_*.md" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "RELATORIO_*.json" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "relatorio_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "relatorio_*.json" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "resultado_*.txt" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "ANALISE_*.md" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "ANALISE_*.json" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "analise_*.txt" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "analise_*.json" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "server.err" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }
Get-ChildItem -Path $baseDir -Filter "server_error.log" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "relatorios") }

Write-Host "`n💾 Dumps de banco de dados..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "*.sql" | Where-Object { $_.Name -like "*backup*" -or $_.Name -like "*dump*" } | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "dumps_db") }
Get-ChildItem -Path $baseDir -Filter "fazer_dump_*.js" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "dumps_db") }

Write-Host "`n📄 Arquivos Excel de teste..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "TESTE_*.xlsx" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "temp_excel") }
Get-ChildItem -Path $baseDir -Filter "teste-*.xlsx" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "temp_excel") }
Get-ChildItem -Path $baseDir -Filter "*.xlsx.backup" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "temp_excel") }

Write-Host "`n🗂️ Backups de código..." -ForegroundColor Cyan
Get-ChildItem -Path $baseDir -Filter "*.before-*" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "backups_codigo") }
Get-ChildItem -Path $baseDir -Filter "*.backup-*" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "backups_codigo") }
Get-ChildItem -Path $baseDir -Filter "*.js.backup_*" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "backups_codigo") }
Get-ChildItem -Path $baseDir -Filter "server.js.before-*" | ForEach-Object { Move-SafeFile $_.FullName (Join-Path $safeDir "backups_codigo") }

# ===================================================================
# RESUMO
# ===================================================================

Write-Host "`n" + ("=" * 70) -ForegroundColor Gray
Write-Host "✅ OPERAÇÃO CONCLUÍDA!" -ForegroundColor Green
Write-Host ("=" * 70) -ForegroundColor Gray
Write-Host "📊 Arquivos movidos: $movedCount" -ForegroundColor Cyan
Write-Host "⚠️  Arquivos ignorados: $skippedCount" -ForegroundColor Yellow
Write-Host "📁 Localização: $safeDir" -ForegroundColor Cyan

Write-Host "`n⚠️  IMPORTANTE:" -ForegroundColor Yellow
Write-Host "  - Os arquivos foram movidos para fora do controle do Git" -ForegroundColor White
Write-Host "  - Verifique o .gitignore para confirmar que está atualizado" -ForegroundColor White
Write-Host "  - Faça backup da pasta _ARQUIVOS_DESENVOLVIMENTO_NAO_VERSIONAR" -ForegroundColor White
Write-Host "  - NÃO commite arquivos com credenciais hardcoded!" -ForegroundColor Red

Write-Host "`n🔒 Recomendações de Segurança:" -ForegroundColor Magenta
Write-Host "  1. Use variáveis de ambiente (.env) para credenciais" -ForegroundColor White
Write-Host "  2. Nunca commite arquivos .env no Git" -ForegroundColor White
Write-Host "  3. Use .env.example como template sem credenciais reais" -ForegroundColor White
Write-Host "  4. Revise o histórico do Git se credenciais foram commitadas" -ForegroundColor White

Write-Host ""
Write-Host "Pressione qualquer tecla para fechar..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
