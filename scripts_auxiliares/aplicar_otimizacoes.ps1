# ============================================================
# SCRIPT DE APLICAÇÃO DE OTIMIZAÇÕES - ALUFORCE
# Execute este script para aplicar todas as otimizações automaticamente
# ============================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  OTIMIZAÇÕES ALUFORCE v2.0" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$ErrorActionPreference = "Continue"
$rootPath = Split-Path -Parent $MyInvocation.MyCommand.Path

# ============================================================
# 1. VERIFICAR ARQUIVOS NECESSÁRIOS
# ============================================================

Write-Host "📂 Verificando arquivos..." -ForegroundColor Yellow

$arquivosNecessarios = @(
    "public\js\aluforce-performance.js",
    "public\js\aluforce-init.js",
    "otimizacao_banco.sql",
    ".env.example"
)

$arquivosFaltando = @()
foreach ($arquivo in $arquivosNecessarios) {
    $caminho = Join-Path $rootPath $arquivo
    if (!(Test-Path $caminho)) {
        $arquivosFaltando += $arquivo
        Write-Host "  ❌ Faltando: $arquivo" -ForegroundColor Red
    } else {
        Write-Host "  ✅ Encontrado: $arquivo" -ForegroundColor Green
    }
}

if ($arquivosFaltando.Count -gt 0) {
    Write-Host "`n❌ Arquivos faltando! Execute os scripts de criação primeiro." -ForegroundColor Red
    exit 1
}

# ============================================================
# 2. CONFIGURAR .ENV
# ============================================================

Write-Host "`n🔧 Configurando .env..." -ForegroundColor Yellow

$envPath = Join-Path $rootPath ".env"
$envExamplePath = Join-Path $rootPath ".env.example"

if (!(Test-Path $envPath)) {
    Write-Host "  📝 Criando arquivo .env a partir do exemplo..." -ForegroundColor Cyan
    Copy-Item $envExamplePath $envPath
    Write-Host "  ✅ Arquivo .env criado!" -ForegroundColor Green
    Write-Host "`n  ⚠️  IMPORTANTE: Edite o arquivo .env e configure:" -ForegroundColor Yellow
    Write-Host "     - DB_PASS (senha do banco de dados)" -ForegroundColor Yellow
    Write-Host "     - JWT_SECRET (gere com: node -e `"console.log(require('crypto').randomBytes(64).toString('hex'))`")" -ForegroundColor Yellow
    Write-Host "`n  Pressione qualquer tecla após configurar o .env..." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
} else {
    Write-Host "  ✅ Arquivo .env já existe" -ForegroundColor Green
}

# ============================================================
# 3. GERAR JWT SECRET (se necessário)
# ============================================================

Write-Host "`n🔐 Verificando JWT_SECRET..." -ForegroundColor Yellow

$envContent = Get-Content $envPath -Raw
if ($envContent -match "JWT_SECRET=sua_chave" -or $envContent -match "JWT_SECRET=\s*$") {
    Write-Host "  🔑 Gerando JWT_SECRET forte..." -ForegroundColor Cyan
    $jwtSecret = & node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
    
    if ($jwtSecret) {
        $envContent = $envContent -replace "JWT_SECRET=.*", "JWT_SECRET=$jwtSecret"
        Set-Content -Path $envPath -Value $envContent -NoNewline
        Write-Host "  ✅ JWT_SECRET gerado e configurado!" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Não foi possível gerar JWT_SECRET. Configure manualmente." -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✅ JWT_SECRET já configurado" -ForegroundColor Green
}

# ============================================================
# 4. BACKUP DO BANCO DE DADOS
# ============================================================

Write-Host "`n💾 Criando backup do banco de dados..." -ForegroundColor Yellow

$backupPath = Join-Path $rootPath "backup-antes-otimizacao-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').sql"

Write-Host "  ⚠️  Deseja criar backup do banco? (S/N)" -ForegroundColor Cyan
$resposta = Read-Host

if ($resposta -eq "S" -or $resposta -eq "s") {
    Write-Host "  Digite a senha do MySQL (root):" -ForegroundColor Cyan
    $senha = Read-Host -AsSecureString
    $senhaTexto = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senha))
    
    Write-Host "  📦 Executando backup..." -ForegroundColor Cyan
    $backupCmd = "mysqldump -u root -p$senhaTexto aluforce_vendas > `"$backupPath`""
    Invoke-Expression $backupCmd
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Backup criado: $backupPath" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Erro ao criar backup. Continue? (S/N)" -ForegroundColor Yellow
        $continuar = Read-Host
        if ($continuar -ne "S" -and $continuar -ne "s") {
            exit 1
        }
    }
} else {
    Write-Host "  ⏭️  Pulando backup (não recomendado)" -ForegroundColor Yellow
}

# ============================================================
# 5. EXECUTAR OTIMIZAÇÕES DO BANCO
# ============================================================

Write-Host "`n🗄️  Aplicando otimizações no banco de dados..." -ForegroundColor Yellow

$sqlPath = Join-Path $rootPath "otimizacao_banco.sql"

Write-Host "  Deseja executar otimizações no banco? (S/N)" -ForegroundColor Cyan
$resposta = Read-Host

if ($resposta -eq "S" -or $resposta -eq "s") {
    Write-Host "  Digite a senha do MySQL (root):" -ForegroundColor Cyan
    $senha = Read-Host -AsSecureString
    $senhaTexto = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senha))
    
    Write-Host "  ⚡ Executando otimizações..." -ForegroundColor Cyan
    $sqlCmd = "mysql -u root -p$senhaTexto aluforce_vendas < `"$sqlPath`""
    Invoke-Expression $sqlCmd
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Otimizações aplicadas com sucesso!" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Erro ao aplicar otimizações" -ForegroundColor Red
        Write-Host "  Execute manualmente: mysql -u root -p aluforce_vendas < otimizacao_banco.sql" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⏭️  Pulando otimizações do banco" -ForegroundColor Yellow
}

# ============================================================
# 6. VERIFICAR INDEX.HTML
# ============================================================

Write-Host "`n📄 Verificando index.html..." -ForegroundColor Yellow

$indexPath = Join-Path $rootPath "public\index.html"
$indexContent = Get-Content $indexPath -Raw

$perfScriptPresente = $indexContent -match "aluforce-performance\.js"
$initScriptPresente = $indexContent -match "aluforce-init\.js"

if (!$perfScriptPresente -or !$initScriptPresente) {
    Write-Host "  ⚠️  Scripts de otimização não encontrados no index.html" -ForegroundColor Yellow
    Write-Host "`n  Para otimização completa, adicione no <head> ANTES dos outros scripts:" -ForegroundColor Cyan
    Write-Host "  <script src=`"/js/aluforce-performance.js`"></script>" -ForegroundColor White
    Write-Host "  <script src=`"/js/aluforce-init.js`"></script>" -ForegroundColor White
    Write-Host "`n  Abrir index.html agora para edição? (S/N)" -ForegroundColor Cyan
    $resposta = Read-Host
    
    if ($resposta -eq "S" -or $resposta -eq "s") {
        notepad $indexPath
    }
} else {
    Write-Host "  ✅ Scripts de otimização já presentes no HTML" -ForegroundColor Green
}

# ============================================================
# 7. INSTALAR/VERIFICAR DEPENDÊNCIAS
# ============================================================

Write-Host "`n📦 Verificando dependências Node.js..." -ForegroundColor Yellow

if (Test-Path (Join-Path $rootPath "package.json")) {
    Write-Host "  Deseja atualizar dependências? (S/N)" -ForegroundColor Cyan
    $resposta = Read-Host
    
    if ($resposta -eq "S" -or $resposta -eq "s") {
        Write-Host "  📥 Instalando/atualizando dependências..." -ForegroundColor Cyan
        Push-Location $rootPath
        npm install
        Pop-Location
        Write-Host "  ✅ Dependências atualizadas!" -ForegroundColor Green
    }
}

# ============================================================
# 8. RELATÓRIO FINAL
# ============================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  RELATÓRIO DE OTIMIZAÇÕES" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "✅ Arquivos de otimização: OK" -ForegroundColor Green
Write-Host "✅ Arquivo .env: " -NoNewline
if (Test-Path $envPath) {
    Write-Host "OK" -ForegroundColor Green
} else {
    Write-Host "FALTANDO" -ForegroundColor Red
}

Write-Host "✅ Scripts no HTML: " -NoNewline
if ($perfScriptPresente -and $initScriptPresente) {
    Write-Host "OK" -ForegroundColor Green
} else {
    Write-Host "PENDENTE" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PRÓXIMOS PASSOS" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "1. ✅ Verificar configurações no .env" -ForegroundColor White
Write-Host "2. ✅ Adicionar scripts no index.html (se necessário)" -ForegroundColor White
Write-Host "3. ✅ Reiniciar o servidor Node.js" -ForegroundColor White
Write-Host "4. ✅ Testar o sistema" -ForegroundColor White
Write-Host "5. ✅ Monitorar logs de performance" -ForegroundColor White

Write-Host "`n📚 DOCUMENTAÇÃO:" -ForegroundColor Cyan
Write-Host "   - RESUMO_EXECUTIVO.md (início rápido)" -ForegroundColor White
Write-Host "   - OTIMIZACOES_APLICADAS.md (guia completo)" -ForegroundColor White
Write-Host "   - ANALISE_SISTEMA_COMPLETA.md (análise técnica)" -ForegroundColor White

Write-Host "`n🚀 Reiniciar servidor agora? (S/N)" -ForegroundColor Cyan
$resposta = Read-Host

if ($resposta -eq "S" -or $resposta -eq "s") {
    Write-Host "`n🔄 Reiniciando servidor..." -ForegroundColor Yellow
    
    # Tentar parar processos Node existentes
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    
    # Iniciar novo servidor
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootPath'; node server.js"
    
    Write-Host "✅ Servidor reiniciado!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Lembre-se de reiniciar o servidor manualmente: node server.js" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  OTIMIZAÇÕES CONCLUÍDAS!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Pressione qualquer tecla para finalizar..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
