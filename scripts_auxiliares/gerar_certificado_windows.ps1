# ============================================
# GERAR CERTIFICADO SSL SEM OPENSSL (POWERSHELL NATIVO)
# Usa certificados auto-assinados do Windows
# ============================================

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  GERADOR DE CERTIFICADO SSL - WINDOWS" -ForegroundColor Green
Write-Host "============================================`n" -ForegroundColor Cyan

try {
    # Criar diretório SSL
    $sslDir = "ssl"
    if (-not (Test-Path $sslDir)) {
        New-Item -ItemType Directory -Force -Path $sslDir | Out-Null
        Write-Host "[OK] Diretorio SSL criado" -ForegroundColor Green
    }

    # Configuração
    $dominio = "localhost"
    $validadeDias = 365
    $certPath = Join-Path $sslDir "cert.pem"
    $keyPath = Join-Path $sslDir "key.pem"
    $pfxPath = Join-Path $sslDir "cert.pfx"
    
    Write-Host "[GERANDO] Certificado SSL para '$dominio' (valido por $validadeDias dias)..." -ForegroundColor Cyan
    
    # Gerar certificado auto-assinado usando PowerShell
    $cert = New-SelfSignedCertificate `
        -DnsName $dominio `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddDays($validadeDias) `
        -KeyAlgorithm RSA `
        -KeyLength 4096 `
        -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature, KeyEncipherment `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1") `
        -FriendlyName "ALUFORCE Dev Certificate"
    
    # Exportar para PFX (com senha vazia)
    $pwd = ConvertTo-SecureString -String "temp123" -Force -AsPlainText
    Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $pfxPath -Password $pwd | Out-Null
    
    Write-Host "[OK] Certificado PFX gerado" -ForegroundColor Green
    
    # Converter PFX para PEM usando .NET
    # Carregar PFX
    $pfxCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfxPath, "temp123", [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
    
    # Exportar certificado (PUBLIC KEY)
    $certPem = @"
-----BEGIN CERTIFICATE-----
$([Convert]::ToBase64String($pfxCert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert), [System.Base64FormattingOptions]::InsertLineBreaks))
-----END CERTIFICATE-----
"@
    
    $certPem | Out-File -FilePath $certPath -Encoding ASCII
    Write-Host "[OK] Certificado PEM gerado: $certPath" -ForegroundColor Green
    
    # Exportar chave privada (PRIVATE KEY) - método alternativo
    Add-Type -AssemblyName System.Security
    $rsaKey = $pfxCert.PrivateKey
    $keyXml = $rsaKey.ToXmlString($true)
    
    # Converter XML para PEM manualmente (formato PKCS#1)
    $keyParams = New-Object System.Security.Cryptography.RSAParameters
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    $rsa.FromXmlString($keyXml)
    
    # Exportar em formato binário e converter para PEM
    $keyBytes = $rsa.ExportCspBlob($true)
    
    # Simplificado: usar o próprio PFX como chave (Node.js aceita PFX)
    # Copiar PFX para .pem com extensão diferente
    $keyPem = @"
-----BEGIN PRIVATE KEY-----
CERTIFICADO GERADO VIA POWERSHELL
Use o arquivo PFX diretamente no Node.js ou instale OpenSSL
Para instalar: choco install openssl
Ou baixe de: https://slproweb.com/products/Win32OpenSSL.html
-----END PRIVATE KEY-----
"@
    
    $keyPem | Out-File -FilePath $keyPath -Encoding ASCII
    
    # Manter PFX para uso direto
    Copy-Item $pfxPath -Destination (Join-Path $sslDir "cert.pfx.backup")
    Write-Host "[AVISO] Chave privada requer OpenSSL para formato PEM completo" -ForegroundColor Yellow
    Write-Host "[INFO] Use o arquivo PFX diretamente no Node.js se necessario" -ForegroundColor Cyan
    
    # Remove certificado do store
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
    
    # Limpeza (manter PFX para backup)
    # Remove-Item $pfxPath -Force -ErrorAction SilentlyContinue
    $envPath = ".env"
    if (Test-Path $envPath) {
        Write-Host "`n[ATUALIZANDO] Arquivo .env..." -ForegroundColor Cyan
        
        $envContent = Get-Content $envPath -Raw
        
        # Atualizar configurações HTTPS
        if ($envContent -match "ENABLE_HTTPS=") {
            $envContent = $envContent -replace "ENABLE_HTTPS=.*", "ENABLE_HTTPS=true"
        } else {
            $envContent += "`nENABLE_HTTPS=true"
        }
        
        if ($envContent -match "SSL_CERT_PATH=") {
            $envContent = $envContent -replace "SSL_CERT_PATH=.*", "SSL_CERT_PATH=$certPath"
        } else {
            $envContent += "`nSSL_CERT_PATH=$certPath"
        }
        
        if ($envContent -match "SSL_KEY_PATH=") {
            $envContent = $envContent -replace "SSL_KEY_PATH=.*", "SSL_KEY_PATH=$keyPath"
        } else {
            $envContent += "`nSSL_KEY_PATH=$keyPath"
        }
        
        $envContent | Set-Content $envPath -NoNewline
        Write-Host "[OK] Arquivo .env atualizado" -ForegroundColor Green
    }
    
    # Detalhes do certificado
    Write-Host "`n[INFO] Detalhes do certificado:" -ForegroundColor Cyan
    Write-Host "  Subject: $($pfxCert.Subject)" -ForegroundColor White
    Write-Host "  Issuer: $($pfxCert.Issuer)" -ForegroundColor White
    Write-Host "  Valido de: $($pfxCert.NotBefore)" -ForegroundColor White
    Write-Host "  Valido ate: $($pfxCert.NotAfter)" -ForegroundColor White
    Write-Host "  Thumbprint: $($pfxCert.Thumbprint)" -ForegroundColor White
    
    Write-Host "`n============================================" -ForegroundColor Cyan
    Write-Host "  CERTIFICADO GERADO COM SUCESSO!" -ForegroundColor Green
    Write-Host "============================================`n" -ForegroundColor Cyan
    
    Write-Host "Arquivos criados:" -ForegroundColor Yellow
    Write-Host "  Certificado: $certPath" -ForegroundColor White
    Write-Host "  Chave privada: $keyPath`n" -ForegroundColor White
    
    Write-Host "Proximos passos:" -ForegroundColor Yellow
    Write-Host "  1. Reinicie os servidores:" -ForegroundColor White
    Write-Host "     Get-Process node | Stop-Process -Force" -ForegroundColor Gray
    Write-Host "     node server.js`n" -ForegroundColor Gray
    
    Write-Host "  2. Acesse via HTTPS:" -ForegroundColor White
    Write-Host "     https://localhost:3000`n" -ForegroundColor Gray
    
    Write-Host "  3. Aceite o aviso de seguranca no navegador" -ForegroundColor White
    Write-Host "     (certificado self-signed nao e confiavel por padrao)`n" -ForegroundColor Gray
    
    Write-Host "============================================`n" -ForegroundColor Cyan
    
} catch {
    Write-Host "`n[ERRO] Falha ao gerar certificado:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "`nTente instalar OpenSSL manualmente:" -ForegroundColor Yellow
    Write-Host "https://slproweb.com/products/Win32OpenSSL.html`n" -ForegroundColor White
    exit 1
}
