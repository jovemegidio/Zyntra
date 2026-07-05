# ============================================================
# ALUFORCE - Deploy VPS sem senha (SSH Key Auth)
# Uso: .\deploy-vps.ps1 [arquivo1] [arquivo2] ...
#      Sem argumentos: envia arquivos modificados recentemente
# ============================================================

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arquivos
)

# Configurar via variável de ambiente ou arquivo deploy-secrets.env (não versionado)
# Exemplo: $env:VPS_HOST = "root@<ip>"; $env:VPS_DISCORD = "<webhook_url>"
$VPS_HOST        = if ($env:VPS_HOST)    { $env:VPS_HOST }    else { "root@<VPS_IP>" }
$VPS_PATH        = if ($env:VPS_PATH)    { $env:VPS_PATH }    else { "/var/www/aluforce" }
$LOCAL           = if ($PSScriptRoot)    { $PSScriptRoot }    else { Split-Path $MyInvocation.MyCommand.Path }
$SSH_KEY         = if ($env:VPS_SSH_KEY) { $env:VPS_SSH_KEY } else { "$env:USERPROFILE\.ssh\id_ed25519_vps" }
$SSH_OPTS        = @("-i", $SSH_KEY, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15")
$DISCORD_WEBHOOK = if ($env:VPS_DISCORD) { $env:VPS_DISCORD } else { "" }

function Send-DiscordDeploy {
    param([string[]]$Arquivos)
    if (-not $DISCORD_WEBHOOK) { return }

    $filesText = if ($Arquivos.Count -gt 0) {
        $list = ($Arquivos | Select-Object -First 15 | ForEach-Object { "``$_``" }) -join "`n"
        if ($Arquivos.Count -gt 15) { $list += "`n... +$($Arquivos.Count - 15) arquivo(s)" }
        $list
    } else { "Nenhum arquivo" }

    $rawCommits = git log --oneline -8 --format="%s" 2>$null
    $commitsText = if ($rawCommits) {
        ($rawCommits | ForEach-Object { "- $_" }) -join "`n"
    } else { "Sem commits recentes" }

    $gitAuthor = git config user.name 2>$null
    $author = if ($gitAuthor) { $gitAuthor } else { "ALUFORCE TI" }
    $hora   = Get-Date -Format "dd/MM/yyyy HH:mm"

    $payload = @{
        embeds = @(@{
            title       = "[Deploy] ALUFORCE ERP"
            color       = 3447003
            description = "$($Arquivos.Count) arquivo(s) enviado(s) para producao com sucesso."
            timestamp   = (Get-Date).ToUniversalTime().ToString("o")
            footer      = @{ text = "ALUFORCE ERP | deploy-vps.ps1" }
            fields      = @(
                @{ name = "Arquivos ($($Arquivos.Count))"; value = $filesText.Substring(0, [Math]::Min($filesText.Length, 1024)); inline = $false },
                @{ name = "Commits Recentes";              value = $commitsText.Substring(0, [Math]::Min($commitsText.Length, 1024)); inline = $false },
                @{ name = "Autor";                         value = $author; inline = $true },
                @{ name = "Horario";                       value = $hora;   inline = $true }
            )
        })
    } | ConvertTo-Json -Depth 10 -Compress

    try {
        Invoke-RestMethod -Uri $DISCORD_WEBHOOK -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
        Write-Host "Discord notificado!" -ForegroundColor Green
    } catch {
        Write-Host "Aviso: Discord nao notificado: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Garante que ssh/scp do Git estejam no PATH
$gitSsh = "C:\Program Files\Git\usr\bin"
if (Test-Path $gitSsh) { $env:PATH = "$gitSsh;$env:PATH" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   ALUFORCE - Deploy VPS (chave SSH)      " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

function Deploy-File {
    param([string]$full)

    if (-not (Test-Path $full)) {
        Write-Host "  ERRO: nao encontrado: $full" -ForegroundColor Red
        return $false
    }

    $rel      = $full.Replace($LOCAL + "\", "") -replace "\\", "/"
    $dir      = ($rel | Split-Path -Parent) -replace "\\", "/"

    if ($dir) {
        ssh @SSH_OPTS $VPS_HOST "mkdir -p $VPS_PATH/$dir" 2>$null
    }

    Write-Host "  -> $rel" -NoNewline -ForegroundColor Yellow
    scp @SSH_OPTS "$full" "${VPS_HOST}:${VPS_PATH}/${rel}" 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host " [OK]" -ForegroundColor Green
        $script:deployedFiles += $rel
        return $true
    } else {
        Write-Host " [ERRO]" -ForegroundColor Red
        return $false
    }
}

$ok            = 0
$err           = 0
$deployedFiles = @()

if ($Arquivos -and $Arquivos.Count -gt 0) {
    foreach ($f in $Arquivos) {
        $full = if ([System.IO.Path]::IsPathRooted($f)) { $f } else { Join-Path $LOCAL $f }
        if (Deploy-File $full) { $ok++ } else { $err++ }
    }
} else {
    Write-Host "Buscando arquivos modificados nas ultimas 2 horas..." -ForegroundColor Gray
    $cutoff = (Get-Date).AddHours(-2)
    $files  = Get-ChildItem -Path $LOCAL -Recurse -File |
              Where-Object {
                  $_.LastWriteTime -gt $cutoff -and
                  $_.FullName -notmatch '\\\.git\\|\\node_modules\\|\\\.vs\\|\\backups\\' -and
                  $_.Extension -match '\.(js|html|css|json|sql|ps1)$'
              } |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 20

    if ($files.Count -eq 0) {
        Write-Host "Nenhum arquivo modificado nas ultimas 2 horas." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "Encontrados $($files.Count) arquivos:" -ForegroundColor Green
    Write-Host ""
    foreach ($f in $files) {
        if (Deploy-File $f.FullName) { $ok++ } else { $err++ }
    }
}

Write-Host ""
Write-Host "------------------------------------------" -ForegroundColor DarkGray
Write-Host "Resultado: $ok enviados, $err erros" -ForegroundColor $(if ($err -eq 0) { "Green" } else { "Yellow" })

if ($ok -gt 0) {
    Write-Host ""
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $restart = Read-Host "Reiniciar PM2? (s/N)"
    } else {
        $restart = "s"
    }
    if ($restart -eq "s" -or $restart -eq "S") {
        Write-Host "Reiniciando PM2 (Aluforce)..." -ForegroundColor Cyan
        ssh @SSH_OPTS $VPS_HOST "pm2 restart aluforce-v2-production --update-env; pm2 save"
        Write-Host "PM2 Aluforce reiniciado!" -ForegroundColor Green

        # Sincroniza dashboard-v2 e index.html para instâncias Labor e reinicia
        Write-Host "Sincronizando interface base para Labor Energy e Labor Eletric..." -ForegroundColor Cyan
        ssh @SSH_OPTS $VPS_HOST @"
mkdir -p /var/www/labor-energy/public /var/www/labor-eletric/public
cp -r /var/www/aluforce/public/dashboard-v2 /var/www/labor-energy/public/
cp -r /var/www/aluforce/public/dashboard-v2 /var/www/labor-eletric/public/
cp -r /var/www/aluforce/public/css /var/www/labor-energy/public/
cp -r /var/www/aluforce/public/css /var/www/labor-eletric/public/
cp -r /var/www/aluforce/public/js /var/www/labor-energy/public/
cp -r /var/www/aluforce/public/js /var/www/labor-eletric/public/
cp -r /var/www/aluforce/public/logos /var/www/labor-energy/public/
cp -r /var/www/aluforce/public/logos /var/www/labor-eletric/public/
cp -r /var/www/aluforce/public/relatorios /var/www/labor-energy/public/
cp -r /var/www/aluforce/public/relatorios /var/www/labor-eletric/public/
cp /var/www/aluforce/public/login.html /var/www/labor-energy/public/login.html
cp /var/www/aluforce/public/login.html /var/www/labor-eletric/public/login.html
cp /var/www/aluforce/public/index.html /var/www/labor-energy/public/index.html
cp /var/www/aluforce/public/index.html /var/www/labor-eletric/public/index.html
mkdir -p /var/www/labor-energy/public/images /var/www/labor-eletric/public/images /var/www/labor-energy/middleware /var/www/labor-eletric/middleware
cp /var/www/aluforce/public/images/labor-eletric-logo.png /var/www/labor-energy/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-eletric-logo.png /var/www/labor-eletric/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-eletric-logo-branco.png /var/www/labor-energy/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-eletric-logo-branco.png /var/www/labor-eletric/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-energy-logo.png /var/www/labor-energy/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-energy-logo.png /var/www/labor-eletric/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-energy-logo-branco.png /var/www/labor-energy/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-energy-logo-branco.png /var/www/labor-eletric/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-energy-logo-preto.png /var/www/labor-energy/public/images/ 2>/dev/null || true
cp /var/www/aluforce/public/images/labor-energy-logo-preto.png /var/www/labor-eletric/public/images/ 2>/dev/null || true
cp /var/www/aluforce/middleware/zyntra-branding.js /var/www/labor-energy/middleware/zyntra-branding.js
cp /var/www/aluforce/middleware/zyntra-branding.js /var/www/labor-eletric/middleware/zyntra-branding.js
pm2 restart labor-energy-demo --update-env
pm2 restart labor-eletric-demo --update-env
pm2 save
"@
        Write-Host "Labor Energy e Labor Eletric sincronizados e reiniciados!" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Notificando Discord..." -ForegroundColor Cyan
    Send-DiscordDeploy -Arquivos $deployedFiles
}
