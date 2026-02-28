# ============================================
# SCRIPT DE INSTALAÇÃO DE PACOTES DE SEGURANÇA
# Sistema ALUFORCE
# ============================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "INSTALAÇÃO DE PACOTES DE SEGURANÇA" -ForegroundColor Cyan
Write-Host "Sistema ALUFORCE V2.0" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se está na pasta raiz do projeto
if (-not (Test-Path "package.json")) {
    Write-Host "❌ Erro: Execute este script na pasta raiz do projeto!" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Instalando pacotes de segurança..." -ForegroundColor Yellow
Write-Host ""

# Instalar pacotes necessários
$packages = @(
    "express-rate-limit@^6.11.0",
    "helmet@^7.1.0",
    "validator@^13.11.0",
    "dotenv@^16.3.1",
    "bcryptjs@^2.4.3"
)

foreach ($package in $packages) {
    Write-Host "  → Instalando $package..." -ForegroundColor Gray
    npm install $package --save 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    ✅ $package instalado" -ForegroundColor Green
    } else {
        Write-Host "    ❌ Erro ao instalar $package" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ Pacotes de segurança instalados com sucesso!" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  PRÓXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Configure o arquivo .env com suas credenciais:" -ForegroundColor White
Write-Host "   - Renomeie .env.example para .env" -ForegroundColor Gray
Write-Host "   - Altere SESSION_SECRET e JWT_SECRET" -ForegroundColor Gray
Write-Host "   - Configure as credenciais do banco de dados" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Execute o script de migração de senhas:" -ForegroundColor White
Write-Host "   .\migrar_senhas_bcrypt.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Reinicie todos os servidores" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
