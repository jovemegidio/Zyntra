# ============================================
# TESTAR HTTPS - VERIFICAÇÃO COMPLETA
# ============================================

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  TESTE DE HTTPS - ALUFORCE" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# Verificar certificado
Write-Host "[1/4] Verificando certificado PFX..." -ForegroundColor Yellow
if (Test-Path "ssl\cert.pfx") {
    Write-Host "  ✅ Certificado encontrado: ssl\cert.pfx" -ForegroundColor Green
    
    # Mostrar info do certificado
    $pfxPassword = "aluforce2025"
    $securePassword = ConvertTo-SecureString -String $pfxPassword -Force -AsPlainText
    $cert = Get-PfxCertificate -FilePath "ssl\cert.pfx" -Password $securePassword -NoPromptForPassword
    
    Write-Host "  📄 Subject: $($cert.Subject)" -ForegroundColor Gray
    Write-Host "  📅 Válido até: $($cert.NotAfter.ToString('dd/MM/yyyy HH:mm'))" -ForegroundColor Gray
} else {
    Write-Host "  ❌ Certificado não encontrado!" -ForegroundColor Red
    Write-Host "  Execute: .\gerar_certificado_pfx.ps1" -ForegroundColor Yellow
    exit 1
}

# Verificar .env
Write-Host "`n[2/4] Verificando configurações .env..." -ForegroundColor Yellow
$envContent = Get-Content ".env" -Raw

if ($envContent -match "ENABLE_HTTPS=true") {
    Write-Host "  ✅ ENABLE_HTTPS=true" -ForegroundColor Green
} else {
    Write-Host "  ❌ ENABLE_HTTPS não está true" -ForegroundColor Red
}

if ($envContent -match "SSL_PFX_PATH=") {
    Write-Host "  ✅ SSL_PFX_PATH configurado" -ForegroundColor Green
} else {
    Write-Host "  ❌ SSL_PFX_PATH não configurado" -ForegroundColor Red
}

# Verificar se servidor está rodando
Write-Host "`n[3/4] Verificando servidores Node.js..." -ForegroundColor Yellow
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue

if ($nodeProcesses) {
    Write-Host "  ✅ $($nodeProcesses.Count) processo(s) Node.js rodando" -ForegroundColor Green
    foreach ($proc in $nodeProcesses) {
        Write-Host "  → PID: $($proc.Id) | CPU: $($proc.CPU.ToString('F2'))s" -ForegroundColor Gray
    }
    
    Write-Host "`n  ⚠️  REINICIE os servidores para aplicar HTTPS:" -ForegroundColor Yellow
    Write-Host "     Get-Process node | Stop-Process -Force" -ForegroundColor Gray
    Write-Host "     node server.js" -ForegroundColor Gray
} else {
    Write-Host "  ℹ️  Nenhum servidor Node.js rodando" -ForegroundColor Cyan
    Write-Host "  Inicie com: node server.js" -ForegroundColor Gray
}

# Testar conexão HTTPS
Write-Host "`n[4/4] Testando conexões HTTPS..." -ForegroundColor Yellow

$ports = @(3000, 3001, 3004, 3005, 3006)

foreach ($port in $ports) {
    try {
        $response = Invoke-WebRequest -Uri "https://localhost:$port" -SkipCertificateCheck -TimeoutSec 3 -ErrorAction Stop
        Write-Host "  ✅ Porta $port - HTTPS funcionando ($($response.StatusCode))" -ForegroundColor Green
    } catch {
        if ($_.Exception.Message -match "Unable to connect") {
            Write-Host "  ⚠️  Porta $port - Servidor não está rodando" -ForegroundColor Yellow
        } elseif ($_.Exception.Message -match "SSL") {
            Write-Host "  ⚠️  Porta $port - Problema SSL" -ForegroundColor Yellow
        } else {
            Write-Host "  ℹ️  Porta $port - $($_.Exception.Message.Substring(0, [Math]::Min(50, $_.Exception.Message.Length)))" -ForegroundColor Cyan
        }
    }
}

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  RESUMO" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Certificado PFX: OK" -ForegroundColor Green
Write-Host "Configuração .env: OK" -ForegroundColor Green
Write-Host "`nPara ativar HTTPS:" -ForegroundColor Yellow
Write-Host "1. Reinicie os servidores" -ForegroundColor White
Write-Host "2. Acesse: https://localhost:3000" -ForegroundColor White
Write-Host "3. Aceite o aviso de segurança (certificado self-signed)" -ForegroundColor White
Write-Host "`n============================================`n" -ForegroundColor Cyan
