# ============================================
# ALUFORCE - Script de Build APK Android
# ============================================
# Execute este script para gerar o APK do app
# ============================================

param(
    [switch]$Release,
    [switch]$Install,
    [switch]$Clean
)

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "ALUFORCE - Build APK"

# Cores
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) { Write-Output $args }
    $host.UI.RawUI.ForegroundColor = $fc
}

# Banner
Clear-Host
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                    📱 ALUFORCE - BUILD APK ANDROID                       ║" -ForegroundColor Cyan
Write-Host "║                    Sistema de Gestão Empresarial                         ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Define diretórios
$ROOT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ANDROID_DIR = Join-Path $ROOT_DIR "android"
$APK_OUTPUT = Join-Path $ROOT_DIR "APK-OUTPUT"

# Verifica se está no diretório correto
if (-not (Test-Path (Join-Path $ROOT_DIR "package.json"))) {
    Write-Host "❌ Execute este script na pasta raiz do projeto ALUFORCE" -ForegroundColor Red
    exit 1
}

# Configura Android SDK
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe")) {
    Write-Host "⚠️  Android SDK não encontrado em: $env:ANDROID_HOME" -ForegroundColor Yellow
    Write-Host "   Tentando localizar automaticamente..." -ForegroundColor Yellow
    
    # Tenta outros caminhos comuns
    $sdkPaths = @(
        "C:\Android\Sdk",
        "$env:USERPROFILE\Android\Sdk",
        "C:\Users\$env:USERNAME\AppData\Local\Android\Sdk"
    )
    
    foreach ($path in $sdkPaths) {
        if (Test-Path "$path\platform-tools\adb.exe") {
            $env:ANDROID_HOME = $path
            Write-Host "✓ SDK encontrado: $path" -ForegroundColor Green
            break
        }
    }
}

# Cria local.properties
$localProps = Join-Path $ANDROID_DIR "local.properties"
"sdk.dir=$($env:ANDROID_HOME -replace '\\', '\\\\')" | Out-File -FilePath $localProps -Encoding utf8 -NoNewline

Write-Host "📍 Diretório: $ROOT_DIR" -ForegroundColor Gray
Write-Host "📍 Android SDK: $env:ANDROID_HOME" -ForegroundColor Gray
Write-Host ""

# Limpa build se solicitado
if ($Clean) {
    Write-Host "🧹 Limpando builds anteriores..." -ForegroundColor Yellow
    Push-Location $ANDROID_DIR
    .\gradlew.bat clean 2>&1 | Out-Null
    Pop-Location
    if (Test-Path $APK_OUTPUT) { Remove-Item $APK_OUTPUT -Recurse -Force }
    Write-Host "✓ Limpeza concluída" -ForegroundColor Green
    Write-Host ""
}

# Sincroniza com Capacitor
Write-Host "📦 [1/3] Sincronizando arquivos web..." -ForegroundColor Cyan
npx cap sync android 2>&1 | Out-Null
Write-Host "✓ Sincronização concluída" -ForegroundColor Green
Write-Host ""

# Prepara ícones
Write-Host "🎨 [2/3] Preparando ícones e splash..." -ForegroundColor Cyan
node preparar_android.js 2>&1 | Out-Null
Write-Host "✓ Ícones preparados" -ForegroundColor Green
Write-Host ""

# Build
$buildType = if ($Release) { "Release" } else { "Debug" }
Write-Host "🔨 [3/3] Gerando APK $buildType..." -ForegroundColor Cyan

Push-Location $ANDROID_DIR
$gradleTask = if ($Release) { "assembleRelease" } else { "assembleDebug" }
$buildOutput = .\gradlew.bat $gradleTask 2>&1

if ($LASTEXITCODE -ne 0 -and $buildOutput -notmatch "BUILD SUCCESSFUL") {
    Write-Host "❌ Erro no build:" -ForegroundColor Red
    $buildOutput | Select-String -Pattern "error:" | ForEach-Object { Write-Host $_.Line -ForegroundColor Red }
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "✓ Build concluído" -ForegroundColor Green
Write-Host ""

# Localiza e copia APK
$apkSubPath = if ($Release) { "release" } else { "debug" }
$apkName = if ($Release) { "app-release" } else { "app-debug" }
$sourcePath = Join-Path $ANDROID_DIR "app\build\outputs\apk\$apkSubPath\$apkName.apk"

if (Test-Path $sourcePath) {
    # Cria pasta de saída
    if (-not (Test-Path $APK_OUTPUT)) { 
        New-Item -ItemType Directory -Path $APK_OUTPUT -Force | Out-Null 
    }
    
    # Obtém versão do package.json
    $packageJson = Get-Content (Join-Path $ROOT_DIR "package.json") | ConvertFrom-Json
    $version = $packageJson.version
    
    # Nome do APK final
    $finalName = "ALUFORCE-v$version-$buildType.apk"
    $destPath = Join-Path $APK_OUTPUT $finalName
    
    Copy-Item $sourcePath $destPath -Force
    
    $size = [math]::Round((Get-Item $destPath).Length / 1MB, 2)
    
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  ✅ APK GERADO COM SUCESSO!                                              ║" -ForegroundColor Green
    Write-Host "╠══════════════════════════════════════════════════════════════════════════╣" -ForegroundColor Green
    Write-Host "║  📱 Arquivo: $finalName" -ForegroundColor White
    Write-Host "║  📊 Tamanho: $size MB" -ForegroundColor White
    Write-Host "║  📂 Local: APK-OUTPUT\" -ForegroundColor White
    Write-Host "╚══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    
    # Instala se solicitado
    if ($Install) {
        Write-Host "📲 Instalando no dispositivo conectado..." -ForegroundColor Cyan
        $adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
        if (Test-Path $adb) {
            & $adb install -r $destPath
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ APK instalado com sucesso!" -ForegroundColor Green
            } else {
                Write-Host "⚠️  Falha na instalação. Verifique se o dispositivo está conectado." -ForegroundColor Yellow
            }
        } else {
            Write-Host "⚠️  ADB não encontrado. Instale manualmente." -ForegroundColor Yellow
        }
    } else {
        Write-Host "💡 Dica: Use -Install para instalar automaticamente no dispositivo" -ForegroundColor Gray
        Write-Host "   Exemplo: .\build-apk.ps1 -Install" -ForegroundColor Gray
    }
    
    # Abre pasta do APK
    Write-Host ""
    $openFolder = Read-Host "Deseja abrir a pasta do APK? (S/N)"
    if ($openFolder -eq "S" -or $openFolder -eq "s") {
        Start-Process explorer $APK_OUTPUT
    }
    
} else {
    Write-Host "❌ APK não encontrado em: $sourcePath" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎉 Processo finalizado!" -ForegroundColor Green
