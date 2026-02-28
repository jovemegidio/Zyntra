# ============================================================
# SCRIPT DE LIMPEZA DO SISTEMA ALUFORCE
# Remove arquivos temporários, testes e desenvolvimento
# ============================================================

$ErrorActionPreference = "SilentlyContinue"
$baseDir = $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " LIMPEZA DO SISTEMA ALUFORCE" -ForegroundColor Cyan  
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Contador de arquivos removidos
$removedCount = 0

# ===========================================
# 1. ARQUIVOS DE TESTE NA RAIZ
# ===========================================
Write-Host "🗑️  Removendo arquivos de teste..." -ForegroundColor Yellow

$testPatterns = @(
    "teste-*.js", "teste-*.html", "teste_*.js", "teste_*.html",
    "test-*.js", "test-*.html", "test_*.js", "test_*.html",
    "testar-*.js", "testar_*.js",
    "TESTE_*.md", "TESTE_*.csv"
)

foreach ($pattern in $testPatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 2. SCRIPTS DE USO ÚNICO (fix_, corrigir_, debug_)
# ===========================================
Write-Host "🗑️  Removendo scripts de uso único..." -ForegroundColor Yellow

$fixPatterns = @(
    "fix-*.js", "fix_*.js", "fix-*.py", "fix_*.py", "fix_*.ps1", "fix_*.sql",
    "corrigir-*.js", "corrigir_*.js", "correcao-*.js",
    "debug-*.js", "debug_*.js",
    "verificar-*.js", "verificar_*.js",
    "validar-*.js", "validar_*.js",
    "auto_fix*.ps1", "smart_fix.py"
)

foreach ($pattern in $fixPatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 3. ARQUIVOS DE ANÁLISE/DOCUMENTAÇÃO TEMPORÁRIA
# ===========================================
Write-Host "🗑️  Removendo arquivos de análise..." -ForegroundColor Yellow

$analisePatterns = @(
    "ANALISE_*.json", "ANALISE_*.md",
    "analise_*.js", "analise_*.json", "analise_*.txt", "analise_*.py",
    "VALIDACAO_*.json",
    "relatorio_*.js", "relatorio_*.json",
    "RELATORIO_*.js", "RELATORIO_*.json",
    "auditoria-*.js", "auditoria_*.js", "auditoria-*.json",
    "varredura_*.js", "varredura_*.json",
    "OTIMIZACAO_*.json",
    "mapeamento_*.txt"
)

foreach ($pattern in $analisePatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 4. ARQUIVOS DE LOG E OUTPUT
# ===========================================
Write-Host "🗑️  Removendo logs e output..." -ForegroundColor Yellow

$logPatterns = @(
    "*.log", "server.err",
    "output.txt", "install_log.txt",
    "migracao_*.txt", "resultado_*.txt"
)

foreach ($pattern in $logPatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 5. ARQUIVOS COMPACTADOS DESNECESSÁRIOS
# ===========================================
Write-Host "🗑️  Removendo ZIPs desnecessários..." -ForegroundColor Yellow

$zipFiles = @("exceljs-master.zip", "jszip-main.zip", "exceljs.tgz", "setimmediate.tgz")
foreach ($f in $zipFiles) {
    $path = Join-Path $baseDir $f
    if (Test-Path $path) {
        Remove-Item $path -Force
        $removedCount++
    }
}

# ===========================================
# 6. BACKUPS ANTIGOS DE SQL (manter apenas mais recente)
# ===========================================
Write-Host "🗑️  Removendo backups antigos..." -ForegroundColor Yellow

# Manter apenas backups de 2025-12-23
$sqlBackups = Get-ChildItem -Path $baseDir -Filter "backup_*.sql" -File | Where-Object { $_.Name -notlike "*2025-12-23*" }
foreach ($f in $sqlBackups) {
    Remove-Item $f.FullName -Force
    $removedCount++
}

# Remover outros backups
$otherBackups = @("aluforce_vendas_backup_*.sql", "backup-db-*.sql")
foreach ($pattern in $otherBackups) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 7. SCRIPTS DE MIGRAÇÃO DE USO ÚNICO
# ===========================================
Write-Host "🗑️  Removendo scripts de migração..." -ForegroundColor Yellow

$migrationPatterns = @(
    "migrar_*.js", "migration_*.js",
    "executar_*.js", "chamar_*.js", "injetar_*.js",
    "popular_*.js", "inserir-*.js", "inserir_*.js",
    "criar_*.js", "create_*.js",
    "importar_*.js", "importar-*.js",
    "processar_*.js",
    "sincronizar_*.js",
    "setup_*.js", "setup-*.js"
)

foreach ($pattern in $migrationPatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 8. SCRIPTS DE ATUALIZAÇÃO/APLICAÇÃO
# ===========================================
Write-Host "🗑️  Removendo scripts de atualização..." -ForegroundColor Yellow

$updatePatterns = @(
    "atualizar_*.js", "atualizar-*.js",
    "aplicar_*.js", "aplicar_*.ps1",
    "converter_*.js", "converter-*.js",
    "padronizar_*.js", "padronizar_*.ps1",
    "substituir_*.js",
    "limpar_*.js", "limpar-*.ps1",
    "otimizar_*.js", "otimizar-*.js",
    "remover_*.js", "remover-*.js", "remove_*.js",
    "rebuild_*.js",
    "update_*.js"
)

foreach ($pattern in $updatePatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 9. ARQUIVOS EXCEL DE TESTE
# ===========================================
Write-Host "🗑️  Removendo arquivos Excel de teste..." -ForegroundColor Yellow

$excelPatterns = @(
    "teste-*.xlsx", "debug-*.xlsx",
    "EXEMPLO_*.xlsx"
)

foreach ($pattern in $excelPatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        Remove-Item $f.FullName -Force
        $removedCount++
    }
}

# ===========================================
# 10. OUTROS ARQUIVOS DESNECESSÁRIOS
# ===========================================
Write-Host "🗑️  Removendo outros arquivos..." -ForegroundColor Yellow

$otherFiles = @(
    "*.unused", "*.bak",
    "demo-*.html", "executar-*.html", "launcher-*.html", "dashboard-*.html",
    "emitir_*.js", "emitir-*.js",
    "gerar_*.js", "gerar-*.js", "gerador_*.js",
    "preencher-*.js", "script-*.js",
    "buscar_*.js", "descobrir_*.js", "descrever_*.js",
    "onde_esta_*.js", "ver-*.js",
    "localizar_*.js", "mapear_*.js",
    "novo_*.js", "info_*.js", "exibir_*.js", "exportar_*.js",
    "fazer_*.js", "finalizar_*.js",
    "investigar_*.js", "resumo_*.js",
    "check_*.js", "contar_*.js",
    "testes_*.js",
    "adicionar_*.js", "ajustar_*.js",
    "adapt_*.js", "implementar_*.js",
    "analisar_*.js", "analisar_*.py",
    "cron_*.js", "diagnostico_*.js", "diagnosticar_*.js",
    "permissoes_*.js",
    "apis_*.js",
    "rotas_*.js",
    "salvar_*.js",
    "simple-*.js", "native-*.js",
    "template-*.js"
)

foreach ($pattern in $otherFiles) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        # Não remover server.js, main.js ou outros essenciais
        if ($f.Name -notin @("server.js", "main.js", "ecosystem.config.js", "ecosystem.production.config.js")) {
            Remove-Item $f.FullName -Force
            $removedCount++
        }
    }
}

# ===========================================
# 11. DIRETÓRIOS TEMPORÁRIOS
# ===========================================
Write-Host "🗑️  Removendo diretórios temporários..." -ForegroundColor Yellow

$tempDirs = @(
    "temp_excel", "temp_jszip", "exceljs-real",
    "backup_modules_20251207_193731",
    ".nyc_output", ".pytest_cache",
    "_ARQUIVOS_DESENVOLVIMENTO_NAO_VERSIONAR"
)

foreach ($dir in $tempDirs) {
    $path = Join-Path $baseDir $dir
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force
        $removedCount++
        Write-Host "   Removido: $dir" -ForegroundColor DarkGray
    }
}

# ===========================================
# 12. ARQUIVOS .MD DE DOCUMENTAÇÃO ANTIGA
# ===========================================
Write-Host "🗑️  Removendo documentação antiga..." -ForegroundColor Yellow

$mdPatterns = @(
    "ATUALIZACAO_*.md", "ATUALIZACOES_*.md",
    "CORRECOES_*.md", "CORRECAO_*.md",
    "IMPLEMENTACAO_*.md",
    "INTEGRACAO_*.md",
    "MELHORIAS_*.md",
    "MIGRACAO_*.md",
    "MODULO_*_DASHBOARD_v3.md", "MODULO_*_COMPLETO.md", "MODULO_*_DOCUMENTACAO.md",
    "MODULO_*_IMPLEMENTACAO*.md", "MODULO_*_IMPLEMENTADO.md", "MODULO_*_ENTREGA*.md",
    "MODULO_*_FINAL*.md", "MODULO_*_KANBAN*.md",
    "OTIMIZACOES_*.md",
    "PERSONALIZACAO_*.txt",
    "PROJETO_*.md", "PROXIMOS_*.md",
    "RELATORIO_*.md",
    "RESUMO_*.md",
    "RH_FASE*.md",
    "SEGURANCA_*.md",
    "SPRINT_*.md",
    "STATUS_*.md",
    "TRABALHO_*.md",
    "VALIDACAO_*.md", "VARREDURA_*.md",
    "VENDAS_*.md",
    "COMPARACAO_*.md",
    "CHAT_*.md",
    "BOB_AI_*.md",
    "FASE_*.md"
)

foreach ($pattern in $mdPatterns) {
    $files = Get-ChildItem -Path $baseDir -Filter $pattern -File
    foreach ($f in $files) {
        # Manter apenas README.md e documentação essencial
        if ($f.Name -ne "README.md") {
            Remove-Item $f.FullName -Force
            $removedCount++
        }
    }
}

# ===========================================
# RESUMO FINAL
# ===========================================
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " LIMPEZA CONCLUÍDA!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Total de itens removidos: $removedCount" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Sistema limpo e pronto para produção!" -ForegroundColor Green
Write-Host ""
