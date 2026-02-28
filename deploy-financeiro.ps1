$ErrorActionPreference = "Continue"
$base = "G:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"
$pw = "Aluforce@2026#Vps"
$vps = "root@31.97.64.102"

# Carregar helper Discord
. "$base\scripts\Notificar-Discord.ps1"

$arquivosEnviados = @()

Write-Host "=== DEPLOY FINANCEIRO MODULE ===" -ForegroundColor Cyan

# Main HTML files
$htmlFiles = @(
    "index.html",
    "dashboard-contas-pagar.html",
    "dashboard-contas-receber.html",
    "plano-contas.html",
    "conciliacao.html",
    "centros-custo.html",
    "impostos.html",
    "contas-pagar.html",
    "contas-receber.html",
    "orcamentos.html",
    "fluxo-caixa.html",
    "bancos.html",
    "relatorios.html"
)

foreach ($f in $htmlFiles) {
    $local = "$base\modules\Financeiro\$f"
    $remote = "/var/www/aluforce/modules/Financeiro/$f"
    Write-Host "  [HTML] $f" -NoNewline
    pscp -pw $pw -batch $local "${vps}:${remote}" 2>&1 | Out-Null
    Write-Host " OK" -ForegroundColor Green
    $arquivosEnviados += "Financeiro/$f"
}

# CSS files
$cssFiles = @(
    "css\financeiro.css",
    "css\financeiro-sidebar-header.css"
)

foreach ($f in $cssFiles) {
    $local = "$base\modules\Financeiro\$f"
    $remote = "/var/www/aluforce/modules/Financeiro/$($f -replace '\\','/')"
    Write-Host "  [CSS] $f" -NoNewline
    pscp -pw $pw -batch $local "${vps}:${remote}" 2>&1 | Out-Null
    Write-Host " OK" -ForegroundColor Green
    $arquivosEnviados += "Financeiro/$($f -replace '\\','/')"
}

# JS user loader
$local = "$base\modules\Financeiro\public\js\financeiro-user-loader.js"
$remote = "/var/www/aluforce/modules/Financeiro/public/js/financeiro-user-loader.js"
Write-Host "  [JS] financeiro-user-loader.js" -NoNewline
pscp -pw $pw -batch $local "${vps}:${remote}" 2>&1 | Out-Null
Write-Host " OK" -ForegroundColor Green
$arquivosEnviados += "Financeiro/public/js/financeiro-user-loader.js"

# Public HTML files
$pubFiles = @(
    "public\fluxo_caixa.html",
    "public\contas_bancarias.html",
    "public\contas_pagar.html",
    "public\contas_receber.html",
    "public\relatorios.html"
)

foreach ($f in $pubFiles) {
    $local = "$base\modules\Financeiro\$f"
    $remote = "/var/www/aluforce/modules/Financeiro/$($f -replace '\\','/')"
    Write-Host "  [PUB] $f" -NoNewline
    pscp -pw $pw -batch $local "${vps}:${remote}" 2>&1 | Out-Null
    Write-Host " OK" -ForegroundColor Green
    $arquivosEnviados += "Financeiro/$($f -replace '\\','/')"
}

Write-Host "`n=== ALL FILES DEPLOYED ===" -ForegroundColor Green

# Restart PM2
Write-Host "`nRestarting PM2..." -ForegroundColor Yellow
plink -ssh $vps -pw $pw -batch "cd /var/www/aluforce; pm2 restart all --update-env 2>&1 | tail -5"

# Notificar Discord
Notificar-Discord -Titulo "Deploy Módulo Financeiro" -Tipo "deploy" -Modulo "Financeiro" -Descricao "Deploy do módulo Financeiro realizado com sucesso." -Arquivos $arquivosEnviados -Enviados $arquivosEnviados.Count

Write-Host "`n=== DEPLOY COMPLETE ===" -ForegroundColor Green
