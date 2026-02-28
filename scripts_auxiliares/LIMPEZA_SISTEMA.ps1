# ============================================
# SCRIPT DE LIMPEZA DO SISTEMA ALUFORCE
# Economia estimada: ~6GB
# ============================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LIMPEZA DO SISTEMA ALUFORCE V.2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$basePath = "c:\Users\egidio\Documents\Sistema - ALUFORCE - V.2"
$totalLimpo = 0

# Funcao para calcular tamanho
function Get-FolderSize($path) {
    if (Test-Path $path) {
        $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        return [math]::Round($size / 1MB, 2)
    }
    return 0
}

# ============================================
# 1. LIMPAR CACHE DE COMPILACAO RUST/TAURI (~3.9GB)
# ============================================
Write-Host "`n[1/7] Limpando cache de compilacao Rust/Tauri..." -ForegroundColor Yellow
$tauriTarget = "$basePath\aluforce-desktop\src-tauri\target"
if (Test-Path $tauriTarget) {
    $size = Get-FolderSize $tauriTarget
    Write-Host "   Removendo: $tauriTarget ($size MB)" -ForegroundColor Gray
    Remove-Item -Path $tauriTarget -Recurse -Force -ErrorAction SilentlyContinue
    $totalLimpo += $size
    Write-Host "   [OK] Removido!" -ForegroundColor Green
} else {
    Write-Host "   Pasta ja removida ou nao existe" -ForegroundColor Gray
}

# ============================================
# 2. LIMPAR INSTALADORES EXE ANTIGOS (~1.2GB)
# Manter apenas a versao mais recente
# ============================================
Write-Host "`n[2/7] Limpando instaladores EXE antigos..." -ForegroundColor Yellow
$distElectron = "$basePath\dist-electron"
if (Test-Path $distElectron) {
    # Listar todos os EXE e manter apenas o mais recente
    $exeFiles = Get-ChildItem -Path $distElectron -Filter "*.exe" -File | Sort-Object LastWriteTime -Descending
    
    if ($exeFiles.Count -gt 1) {
        $maisRecente = $exeFiles[0]
        Write-Host "   Mantendo versao mais recente: $($maisRecente.Name)" -ForegroundColor Cyan
        
        foreach ($exe in $exeFiles | Select-Object -Skip 1) {
            $sizeMB = [math]::Round($exe.Length / 1MB, 2)
            Write-Host "   Removendo: $($exe.Name) ($sizeMB MB)" -ForegroundColor Gray
            Remove-Item -Path $exe.FullName -Force -ErrorAction SilentlyContinue
            $totalLimpo += $sizeMB
        }
        Write-Host "   [OK] Instaladores antigos removidos!" -ForegroundColor Green
    } else {
        Write-Host "   Nenhum instalador antigo para remover" -ForegroundColor Gray
    }
}

# ============================================
# 3. LIMPAR PASTA WIN-UNPACKED (~334MB)
# ============================================
Write-Host "`n[3/7] Limpando pasta win-unpacked..." -ForegroundColor Yellow
$winUnpacked = "$basePath\dist-electron\win-unpacked"
if (Test-Path $winUnpacked) {
    $size = Get-FolderSize $winUnpacked
    Write-Host "   Removendo: $winUnpacked ($size MB)" -ForegroundColor Gray
    Remove-Item -Path $winUnpacked -Recurse -Force -ErrorAction SilentlyContinue
    $totalLimpo += $size
    Write-Host "   [OK] Removido!" -ForegroundColor Green
} else {
    Write-Host "   Pasta ja removida ou nao existe" -ForegroundColor Gray
}

# ============================================
# 4. LIMPAR DIST DO ELECTRON (~317MB)
# ============================================
Write-Host "`n[4/7] Limpando dist do aluforce-electron..." -ForegroundColor Yellow
$electronDist = "$basePath\aluforce-electron\dist"
if (Test-Path $electronDist) {
    $size = Get-FolderSize $electronDist
    Write-Host "   Removendo: $electronDist ($size MB)" -ForegroundColor Gray
    Remove-Item -Path $electronDist -Recurse -Force -ErrorAction SilentlyContinue
    $totalLimpo += $size
    Write-Host "   [OK] Removido!" -ForegroundColor Green
} else {
    Write-Host "   Pasta ja removida ou nao existe" -ForegroundColor Gray
}

# ============================================
# 5. LIMPAR ARQUIVOS SQL DE BACKUP ANTIGOS
# ============================================
Write-Host "`n[5/7] Limpando arquivos SQL de backup antigos..." -ForegroundColor Yellow

# Lista de arquivos SQL que podem ser removidos (backups duplicados/antigos)
$sqlParaRemover = @(
    "$basePath\aluforce_vendas_backup_2025-12-27T14-37-07.sql",
    "$basePath\aluforce_vendas_corrigido.sql",
    "$basePath\aluforce_vendas_final.sql",
    "$basePath\backup-db-1766984400945.sql",
    "$basePath\backup-db-1767070800546.sql",
    "$basePath\backup-db-1767157200018.sql",
    "$basePath\backup-db-1767157200747.sql",
    "$basePath\backup-db-1767243600814.sql"
)

foreach ($sql in $sqlParaRemover) {
    if (Test-Path $sql) {
        $file = Get-Item $sql
        $sizeMB = [math]::Round($file.Length / 1MB, 2)
        Write-Host "   Removendo: $($file.Name) ($sizeMB MB)" -ForegroundColor Gray
        Remove-Item -Path $sql -Force -ErrorAction SilentlyContinue
        $totalLimpo += $sizeMB
    }
}
Write-Host "   [OK] SQLs antigos removidos!" -ForegroundColor Green

# ============================================
# 6. LIMPAR LOGS ANTIGOS
# ============================================
Write-Host "`n[6/7] Limpando logs antigos..." -ForegroundColor Yellow
$logsPath = "$basePath\logs"
if (Test-Path $logsPath) {
    # Remover logs com mais de 7 dias, exceto combined.log e error.log atuais
    $logsAntigos = Get-ChildItem -Path $logsPath -File | Where-Object { 
        $_.LastWriteTime -lt (Get-Date).AddDays(-7) -or 
        $_.Name -match "^out-\d+\.log$" -or
        $_.Name -match "^combined-\d+\.log$"
    }
    
    foreach ($log in $logsAntigos) {
        $sizeMB = [math]::Round($log.Length / 1MB, 2)
        Write-Host "   Removendo: $($log.Name)" -ForegroundColor Gray
        Remove-Item -Path $log.FullName -Force -ErrorAction SilentlyContinue
        $totalLimpo += $sizeMB
    }
    
    # Limpar conteudo dos logs atuais (manter arquivo vazio)
    $combinedLog = "$logsPath\combined.log"
    $errorLog = "$logsPath\error.log"
    
    if (Test-Path $combinedLog) {
        $size = [math]::Round((Get-Item $combinedLog).Length / 1MB, 2)
        Clear-Content -Path $combinedLog -ErrorAction SilentlyContinue
        $totalLimpo += $size
        Write-Host "   Limpando conteudo de combined.log ($size MB)" -ForegroundColor Gray
    }
    
    Write-Host "   [OK] Logs limpos!" -ForegroundColor Green
}

# ============================================
# 7. LIMPAR PASTA _ARQUIVOS_DESENVOLVIMENTO
# ============================================
Write-Host "`n[7/7] Limpando pasta de desenvolvimento temporaria..." -ForegroundColor Yellow
$devPath = "$basePath\_ARQUIVOS_DESENVOLVIMENTO_NAO_VERSIONAR"
if (Test-Path $devPath) {
    $size = Get-FolderSize $devPath
    Write-Host "   Removendo: $devPath ($size MB)" -ForegroundColor Gray
    Remove-Item -Path $devPath -Recurse -Force -ErrorAction SilentlyContinue
    $totalLimpo += $size
    Write-Host "   [OK] Removido!" -ForegroundColor Green
} else {
    Write-Host "   Pasta ja removida ou nao existe" -ForegroundColor Gray
}

# ============================================
# RESUMO FINAL
# ============================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  LIMPEZA CONCLUIDA!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Espaco liberado: $totalLimpo MB (~$([math]::Round($totalLimpo/1024, 2)) GB)" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "NOTA: Para liberar ainda mais espaco, voce pode executar:" -ForegroundColor Yellow
Write-Host "  - 'npm cache clean --force' (limpa cache npm global)" -ForegroundColor Gray
Write-Host "  - Remover node_modules e reinstalar com 'npm install'" -ForegroundColor Gray
Write-Host ""
