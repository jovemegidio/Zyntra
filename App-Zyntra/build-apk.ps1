# ============================================================
# Zyntra — Gerar APK via EAS Cloud Build
# Execute: .\build-apk.ps1
# ============================================================

$env:PATH = "C:\Program Files\nodejs;C:\Users\$env:USERNAME\AppData\Roaming\npm;$env:PATH"

$eas = "C:\Users\$env:USERNAME\AppData\Roaming\npm\eas.cmd"

if (-not (Test-Path $eas)) {
    Write-Host "Instalando EAS CLI..." -ForegroundColor Yellow
    npm install -g eas-cli
}

# Verifica login
$whoami = & $eas whoami 2>&1
if ($whoami -match "Not logged in") {
    Write-Host ""
    Write-Host "Faca login na sua conta Expo/EAS:" -ForegroundColor Cyan
    & $eas login
}

Write-Host ""
Write-Host "Iniciando build do APK (perfil: preview)..." -ForegroundColor Green
Write-Host "API: https://zyntraerp.com.br/api (seleção automática por domínio no login)" -ForegroundColor DarkGray
Write-Host ""

Set-Location $PSScriptRoot
& $eas build --platform android --profile preview --non-interactive
