# ============================================
# GERADOR DE CERTIFICADO SSL - WINDOWS (PFX)
# Versão simplificada que gera apenas PFX
# ============================================

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  GERADOR DE CERTIFICADO SSL - WINDOWS" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

try {
    # Configurações
    $dnsNames = @("localhost", "127.0.0.1", "::1", "*.localhost")
    $validDays = 365
    $certPassword = "aluforce2025"
    
    # Criar diretório SSL
    $sslDir = "ssl"
    if (-not (Test-Path $sslDir)) {
        New-Item -ItemType Directory -Path $sslDir -Force | Out-Null
        Write-Host "[OK] Diretorio SSL criado" -ForegroundColor Green
    }
    
    # Gerar certificado
    Write-Host "[GERANDO] Certificado SSL para 'localhost' (valido por $validDays dias)..." -ForegroundColor Yellow
    
    $cert = New-SelfSignedCertificate `
        -Subject "CN=localhost" `
        -DnsName $dnsNames `
        -KeyAlgorithm RSA `
        -KeyLength 4096 `
        -NotAfter (Get-Date).AddDays($validDays) `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -FriendlyName "ALUFORCE Development SSL" `
        -HashAlgorithm SHA256 `
        -KeyUsage DigitalSignature, KeyEncipherment `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")
    
    # Exportar para PFX
    $pfxPath = Join-Path $sslDir "cert.pfx"
    $securePassword = ConvertTo-SecureString -String $certPassword -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword -Force | Out-Null
    Write-Host "[OK] Certificado PFX gerado: $pfxPath" -ForegroundColor Green
    
    # Remover do store
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
    
    # Atualizar .env
    $envPath = ".env"
    $envContent = ""
    
    if (Test-Path $envPath) {
        $envContent = Get-Content $envPath -Raw
    }
    
    # Remover configurações antigas de SSL
    $envContent = $envContent -replace "(?m)^ENABLE_HTTPS=.*`r?`n?", ""
    $envContent = $envContent -replace "(?m)^SSL_PFX_PATH=.*`r?`n?", ""
    $envContent = $envContent -replace "(?m)^SSL_PFX_PASSWORD=.*`r?`n?", ""
    $envContent = $envContent -replace "(?m)^SSL_CERT_PATH=.*`r?`n?", ""
    $envContent = $envContent -replace "(?m)^SSL_KEY_PATH=.*`r?`n?", ""
    
    # Adicionar novas configurações
    $envContent += "`n# HTTPS Configuration (PFX)`n"
    $envContent += "ENABLE_HTTPS=true`n"
    $envContent += "SSL_PFX_PATH=$pfxPath`n"
    $envContent += "SSL_PFX_PASSWORD=$certPassword`n"
    
    $envContent | Out-File -FilePath $envPath -Encoding UTF8 -NoNewline
    Write-Host "[OK] Arquivo .env atualizado" -ForegroundColor Green
    
    # Informações do certificado
    $pfxCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfxPath, $certPassword)
    
    Write-Host "`n============================================" -ForegroundColor Cyan
    Write-Host "  CERTIFICADO GERADO COM SUCESSO!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "`nArquivos gerados:" -ForegroundColor White
    Write-Host "  $pfxPath" -ForegroundColor Yellow
    Write-Host "`nInformacoes do certificado:" -ForegroundColor White
    Write-Host "  Subject: $($pfxCert.Subject)" -ForegroundColor White
    Write-Host "  Valido de: $($pfxCert.NotBefore.ToString('dd/MM/yyyy HH:mm'))" -ForegroundColor White
    Write-Host "  Valido ate: $($pfxCert.NotAfter.ToString('dd/MM/yyyy HH:mm'))" -ForegroundColor White
    Write-Host "  Senha PFX: $certPassword" -ForegroundColor White
    Write-Host "  Thumbprint: $($pfxCert.Thumbprint)" -ForegroundColor White
    
    Write-Host "`n============================================" -ForegroundColor Cyan
    Write-Host "  PROXIMOS PASSOS" -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "1. Reinicie os servidores:" -ForegroundColor White
    Write-Host "   Get-Process node | Stop-Process -Force" -ForegroundColor Gray
    Write-Host "   node server.js" -ForegroundColor Gray
    Write-Host "`n2. Acesse via HTTPS:" -ForegroundColor White
    Write-Host "   https://localhost:3000" -ForegroundColor Gray
    Write-Host "`n3. Aceite o aviso de seguranca do navegador" -ForegroundColor White
    Write-Host "   (certificado self-signed e esperado em desenvolvimento)" -ForegroundColor Gray
    Write-Host "`n============================================`n" -ForegroundColor Cyan
    
} catch {
    Write-Host "`n[ERRO] Falha ao gerar certificado:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "`nTente executar como Administrador ou verifique permissoes.`n" -ForegroundColor Yellow
    exit 1
}
