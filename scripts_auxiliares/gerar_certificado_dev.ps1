# ============================================
# GERAR CERTIFICADO SSL SELF-SIGNED PARA DESENVOLVIMENTO
# ============================================

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  GERADOR DE CERTIFICADO SSL - DEV" -ForegroundColor Green
Write-Host "============================================`n" -ForegroundColor Cyan

# Verificar se OpenSSL está instalado
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue

if (-not $opensslPath) {
    Write-Host "[ERRO] OpenSSL nao encontrado no sistema!" -ForegroundColor Red
    Write-Host "`nPara instalar OpenSSL no Windows:" -ForegroundColor Yellow
    Write-Host "1. Baixar de: https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor White
    Write-Host "2. Ou via Chocolatey: choco install openssl" -ForegroundColor White
    Write-Host "3. Ou via Scoop: scoop install openssl`n" -ForegroundColor White
    exit 1
}

Write-Host "[OK] OpenSSL encontrado: $($opensslPath.Source)" -ForegroundColor Green

# Criar diretório SSL se não existir
$sslDir = "ssl"
if (-not (Test-Path $sslDir)) {
    New-Item -ItemType Directory -Force -Path $sslDir | Out-Null
    Write-Host "[OK] Diretorio SSL criado" -ForegroundColor Green
} else {
    Write-Host "[OK] Diretorio SSL ja existe" -ForegroundColor Yellow
}

# Configuração do certificado
$dominio = Read-Host "`nDominio ou IP (Enter para 'localhost')"
if ([string]::IsNullOrWhiteSpace($dominio)) {
    $dominio = "localhost"
}

$validadeDias = Read-Host "Validade em dias (Enter para 365)"
if ([string]::IsNullOrWhiteSpace($validadeDias)) {
    $validadeDias = 365
}

Write-Host "`n[GERANDO] Certificado SSL para '$dominio' (valido por $validadeDias dias)..." -ForegroundColor Cyan

# Gerar chave privada e certificado
$certPath = Join-Path $sslDir "cert.pem"
$keyPath = Join-Path $sslDir "key.pem"

try {
    # Comando OpenSSL para gerar certificado self-signed
    $opensslCmd = "req -x509 -newkey rsa:4096 -keyout `"$keyPath`" -out `"$certPath`" -days $validadeDias -nodes -subj `"/CN=$dominio/O=ALUFORCE/C=BR`""
    
    Start-Process -FilePath "openssl" -ArgumentList $opensslCmd -NoNewWindow -Wait
    
    if (Test-Path $certPath -and Test-Path $keyPath) {
        Write-Host "`n[OK] Certificado gerado com sucesso!" -ForegroundColor Green
        Write-Host "`nArquivos criados:" -ForegroundColor Cyan
        Write-Host "  Certificado: $certPath" -ForegroundColor White
        Write-Host "  Chave privada: $keyPath" -ForegroundColor White
        
        # Verificar certificado
        Write-Host "`n[INFO] Detalhes do certificado:" -ForegroundColor Cyan
        openssl x509 -in $certPath -noout -subject -dates
        
        # Atualizar .env
        $envPath = ".env"
        if (Test-Path $envPath) {
            Write-Host "`n[ATUALIZANDO] Arquivo .env..." -ForegroundColor Cyan
            
            $envContent = Get-Content $envPath -Raw
            
            # Atualizar ou adicionar configurações HTTPS
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
            Write-Host "[OK] Arquivo .env atualizado com configuracoes HTTPS" -ForegroundColor Green
        }
        
        # Instruções finais
        Write-Host "`n============================================" -ForegroundColor Cyan
        Write-Host "  PROXIMOS PASSOS" -ForegroundColor Green
        Write-Host "============================================`n" -ForegroundColor Cyan
        
        Write-Host "1. Reinicie os servidores Node.js:" -ForegroundColor Yellow
        Write-Host "   Get-Process node | Stop-Process -Force" -ForegroundColor White
        Write-Host "   node server.js`n" -ForegroundColor White
        
        Write-Host "2. Acesse via HTTPS:" -ForegroundColor Yellow
        Write-Host "   https://$dominio`:3000`n" -ForegroundColor White
        
        Write-Host "3. Aceite o aviso de seguranca no navegador" -ForegroundColor Yellow
        Write-Host "   (certificado self-signed nao e confiavel por padrao)`n" -ForegroundColor White
        
        Write-Host "4. OPCIONAL: Instalar certificado como confiavel (requer admin):" -ForegroundColor Yellow
        Write-Host "   Import-Certificate -FilePath '$certPath' -CertStoreLocation Cert:\LocalMachine\Root`n" -ForegroundColor White
        
        Write-Host "============================================`n" -ForegroundColor Cyan
        
    } else {
        Write-Host "`n[ERRO] Falha ao gerar certificado!" -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "`n[ERRO] Erro ao executar OpenSSL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
