# Deploy Enterprise 10/10 files to VPS
$VPS = "31.97.64.102"
$USER = "root"
$PASS = "Aluforce@2026#Vps"
$REMOTE = "/var/www/aluforce"
$LOCAL = "g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"

# Carregar helper Discord
. "$LOCAL\scripts\Notificar-Discord.ps1"

Write-Host "=== DEPLOY ENTERPRISE 10/10 ===" -ForegroundColor Cyan

# Create dirs on VPS
Write-Host "[0/8] Creating directories on VPS..." -ForegroundColor Yellow
& plink -ssh "$USER@$VPS" -pw $PASS -batch "mkdir -p $REMOTE/services $REMOTE/_shared"

# Upload files
$files = @(
    @{ local = "$LOCAL\services\rate-limiter-redis.js"; remote = "$REMOTE/services/rate-limiter-redis.js" },
    @{ local = "$LOCAL\security-middleware.js"; remote = "$REMOTE/security-middleware.js" },
    @{ local = "$LOCAL\ecosystem.config.js"; remote = "$REMOTE/ecosystem.config.js" },
    @{ local = "$LOCAL\server.js"; remote = "$REMOTE/server.js" },
    @{ local = "$LOCAL\_shared\fetch-utils.js"; remote = "$REMOTE/_shared/fetch-utils.js" },
    @{ local = "$LOCAL\_shared\chunk-loader.js"; remote = "$REMOTE/_shared/chunk-loader.js" }
)

$i = 1
foreach ($f in $files) {
    Write-Host "[$i/6] Uploading $($f.remote | Split-Path -Leaf)..." -ForegroundColor Yellow
    & pscp -pw $PASS -scp $f.local "${USER}@${VPS}:$($f.remote)"
    $i++
}

# Install npm package and restart
Write-Host "[7/8] Installing rate-limit-redis + Restart PM2..." -ForegroundColor Yellow
& plink -ssh "$USER@$VPS" -pw $PASS -batch "cd $REMOTE; npm install rate-limit-redis --save --force 2>&1 | tail -5; pm2 delete all 2>/dev/null; REDIS_URL=redis://localhost:6379 pm2 start ecosystem.config.js --env production; sleep 4; pm2 list"

# Verify
Write-Host "[8/8] Verifying..." -ForegroundColor Yellow
& plink -ssh "$USER@$VPS" -pw $PASS -batch "curl -s http://localhost:3000/api/health 2>&1 | head -20; ls -la $REMOTE/services/rate-limiter-redis.js $REMOTE/_shared/fetch-utils.js $REMOTE/_shared/chunk-loader.js 2>&1"

# Notificar Discord
$arquivosDeployed = $files | ForEach-Object { Split-Path $_.remote -Leaf }
Notificar-Discord -Titulo "Deploy Enterprise 10/10" -Tipo "deploy" -Modulo "Enterprise" -Descricao "Deploy Enterprise com rate-limiter, security middleware e utilitários." -Arquivos $arquivosDeployed -Enviados $files.Count

Write-Host "=== DEPLOY COMPLETE ===" -ForegroundColor Green
