# ═══════════════════════════════════════════════════════════════════════════════
#  ALUFORCE ERP - Script de Build Completo e Profissional
#  Gera TODAS as versões distribuíveis: Instalador + Portátil
# ═══════════════════════════════════════════════════════════════════════════════
#
#  VERSÕES GERADAS:
#  ✓ Instalador NSIS (.exe) - Instalação completa no sistema
#  ✓ Versão Portátil (.exe) - Executável standalone sem instalação
#
#  REQUISITOS:
#  - Node.js 18+ instalado
#  - electron-builder instalado (npm install -g electron-builder)
#
#  USO:
#    .\BUILD-DISTRIBUICAO.ps1              # Build completo (recomendado)
#    .\BUILD-DISTRIBUICAO.ps1 -Clean       # Limpar cache e rebuildar
#    .\BUILD-DISTRIBUICAO.ps1 -OnlyCheck   # Apenas verificar ambiente
#
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [switch]$Clean,
    [switch]$OnlyCheck,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

# ─────────────────────────────────────────────────────────────────────────────
#  CONFIGURAÇÕES
# ─────────────────────────────────────────────────────────────────────────────

$APP_NAME = "ALUFORCE ERP"
$APP_VERSION = "2.2.0"
$OUTPUT_DIR = "dist-release"
$TEMP_DIR = "temp-build"

# ─────────────────────────────────────────────────────────────────────────────
#  FUNÇÕES AUXILIARES
# ─────────────────────────────────────────────────────────────────────────────

function Write-Header {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $APP_NAME - BUILD PROFISSIONAL v$APP_VERSION" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($step, $message) {
    Write-Host "[$step] " -ForegroundColor Yellow -NoNewline
    Write-Host $message -ForegroundColor White
}

function Write-Success($message) {
    Write-Host "✓ " -ForegroundColor Green -NoNewline
    Write-Host $message -ForegroundColor White
}

function Write-Error($message) {
    Write-Host "✗ " -ForegroundColor Red -NoNewline
    Write-Host $message -ForegroundColor Red
}

function Write-Info($message) {
    Write-Host "ℹ " -ForegroundColor Blue -NoNewline
    Write-Host $message -ForegroundColor White
}

function Test-Command($command) {
    try {
        Get-Command $command -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Get-FolderSize($path) {
    if (Test-Path $path) {
        $size = (Get-ChildItem -Path $path -Recurse -Force | Measure-Object -Property Length -Sum).Sum
        return [math]::Round($size / 1MB, 2)
    }
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
#  VERIFICAÇÃO DO AMBIENTE
# ─────────────────────────────────────────────────────────────────────────────

function Test-Environment {
    Write-Step "1/9" "Verificando ambiente de build..."
    
    $errors = @()
    
    # Node.js
    if (Test-Command "node") {
        $nodeVersion = node --version
        Write-Success "Node.js $nodeVersion instalado"
    }
    else {
        $errors += "Node.js não encontrado. Instale em: https://nodejs.org/"
        Write-Error "Node.js não encontrado"
    }
    
    # NPM
    if (Test-Command "npm") {
        $npmVersion = npm --version
        Write-Success "NPM $npmVersion instalado"
    }
    else {
        $errors += "NPM não encontrado"
        Write-Error "NPM não encontrado"
    }
    
    # Electron Builder
    if (Test-Command "electron-builder") {
        Write-Success "electron-builder instalado"
    }
    else {
        Write-Info "Instalando electron-builder globalmente..."
        npm install -g electron-builder
        Write-Success "electron-builder instalado"
    }
    
    # Package.json
    if (Test-Path "package.json") {
        Write-Success "package.json encontrado"
    }
    else {
        $errors += "package.json não encontrado"
        Write-Error "package.json não encontrado"
    }
    
    # Electron builder config
    if (Test-Path "electron-builder.yml") {
        Write-Success "electron-builder.yml encontrado"
    }
    else {
        Write-Info "electron-builder.yml não encontrado, será usado package.json"
    }
    
    # Estrutura do projeto
    $requiredDirs = @("electron", "public", "src", "modules")
    foreach ($dir in $requiredDirs) {
        if (Test-Path $dir) {
            Write-Success "Diretório '$dir' encontrado"
        }
        else {
            Write-Error "Diretório '$dir' não encontrado"
            $errors += "Diretório obrigatório '$dir' não encontrado"
        }
    }
    
    if ($errors.Count -gt 0) {
        Write-Host ""
        Write-Host "ERROS ENCONTRADOS:" -ForegroundColor Red
        foreach ($error in $errors) {
            Write-Host "  • $error" -ForegroundColor Red
        }
        Write-Host ""
        exit 1
    }
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  LIMPEZA
# ─────────────────────────────────────────────────────────────────────────────

function Clear-BuildArtifacts {
    Write-Step "2/9" "Limpando arquivos antigos..."
    
    $dirsToClean = @($OUTPUT_DIR, $TEMP_DIR, "dist", "build/electron")
    
    foreach ($dir in $dirsToClean) {
        if (Test-Path $dir) {
            $size = Get-FolderSize $dir
            Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Success "Removido: $dir ($size MB)"
        }
    }
    
    if ($Clean) {
        Write-Info "Limpando cache do electron-builder..."
        if (Test-Path "$env:LOCALAPPDATA\electron") {
            Remove-Item -Path "$env:LOCALAPPDATA\electron" -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path "$env:LOCALAPPDATA\electron-builder") {
            Remove-Item -Path "$env:LOCALAPPDATA\electron-builder" -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Success "Cache limpo"
    }
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  INSTALAÇÃO DE DEPENDÊNCIAS
# ─────────────────────────────────────────────────────────────────────────────

function Install-Dependencies {
    Write-Step "3/9" "Instalando dependências..."
    
    if (-not (Test-Path "node_modules")) {
        Write-Info "Primeira instalação - isso pode demorar alguns minutos..."
    }
    
    $startTime = Get-Date
    npm install --legacy-peer-deps 2>&1 | Out-Null
    $duration = ((Get-Date) - $startTime).TotalSeconds
    
    $size = Get-FolderSize "node_modules"
    Write-Success "Dependências instaladas ($size MB em $([math]::Round($duration, 1))s)"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  VERIFICAÇÃO DE INTEGRIDADE
# ─────────────────────────────────────────────────────────────────────────────

function Test-ProjectIntegrity {
    Write-Step "4/9" "Verificando integridade do projeto..."
    
    # Verificar server.js
    if (Test-Path "server.js") {
        $serverSize = (Get-Item "server.js").Length / 1KB
        Write-Success "server.js ($([math]::Round($serverSize, 1)) KB)"
    }
    else {
        Write-Error "server.js não encontrado!"
        exit 1
    }
    
    # Verificar electron/main.js
    if (Test-Path "electron/main.js") {
        Write-Success "electron/main.js encontrado"
    }
    else {
        Write-Error "electron/main.js não encontrado!"
        exit 1
    }
    
    # Contar arquivos
    $jsFiles = (Get-ChildItem -Path . -Filter "*.js" -Recurse -File | Where-Object { $_.FullName -notmatch "node_modules" }).Count
    $htmlFiles = (Get-ChildItem -Path "public" -Filter "*.html" -Recurse -File -ErrorAction SilentlyContinue).Count
    
    Write-Success "$jsFiles arquivos JavaScript"
    Write-Success "$htmlFiles arquivos HTML"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  PREPARAÇÃO DE ASSETS
# ─────────────────────────────────────────────────────────────────────────────

function Prepare-Assets {
    Write-Step "5/9" "Preparando assets visuais..."
    
    # Criar diretório de assets se não existir
    if (-not (Test-Path "assets")) {
        New-Item -ItemType Directory -Path "assets" -Force | Out-Null
    }
    
    # Verificar ícones necessários
    $requiredIcons = @{
        "icon.ico" = "Ícone principal"
        "icon.png" = "Ícone PNG"
    }
    
    foreach ($icon in $requiredIcons.Keys) {
        $iconPath = "assets/$icon"
        if (Test-Path $iconPath) {
            $size = (Get-Item $iconPath).Length / 1KB
            Write-Success "$($requiredIcons[$icon]): $icon ($([math]::Round($size, 1)) KB)"
        }
        else {
            Write-Info "$icon não encontrado - será usado ícone padrão"
        }
    }
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  CRIAÇÃO DA LICENÇA
# ─────────────────────────────────────────────────────────────────────────────

function Create-License {
    Write-Step "6/9" "Criando arquivo de licença..."
    
    $licenseContent = @"
LICENÇA DE USO - ALUFORCE ERP
═══════════════════════════════════════════════════════════════

Copyright (c) $(Get-Date -Format yyyy) ALUFORCE Sistemas

TERMOS E CONDIÇÕES:

1. Este software é fornecido "como está", sem garantias de qualquer tipo.

2. Uso permitido apenas para fins autorizados pela ALUFORCE.

3. Proibida a redistribuição sem autorização expressa.

4. Suporte técnico disponível em: contato@aluforce.com

Para mais informações, visite: https://www.aluforce.com

═══════════════════════════════════════════════════════════════
"@
    
    Set-Content -Path "LICENSE.txt" -Value $licenseContent -Encoding UTF8
    Write-Success "LICENSE.txt criado"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  BUILD DO INSTALADOR
# ─────────────────────────────────────────────────────────────────────────────

function Build-Installer {
    Write-Step "7/9" "Gerando INSTALADOR (.exe)..."
    Write-Info "Isso pode demorar alguns minutos - aguarde..."
    Write-Host ""
    
    $startTime = Get-Date
    
    try {
        # Build usando electron-builder
        npx electron-builder build --win nsis --x64 --config electron-builder.yml 2>&1 | ForEach-Object {
            if ($_ -match "error|fail") {
                Write-Host $_ -ForegroundColor Red
            }
            elseif ($_ -match "warning") {
                Write-Host $_ -ForegroundColor Yellow
            }
            elseif ($_ -match "packaging|building|generating") {
                Write-Host "  $_" -ForegroundColor Gray
            }
        }
        
        $duration = ((Get-Date) - $startTime).TotalSeconds
        Write-Success "Instalador gerado em $([math]::Round($duration, 1))s"
    }
    catch {
        Write-Error "Erro ao gerar instalador: $_"
        exit 1
    }
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  BUILD DA VERSÃO PORTÁTIL
# ─────────────────────────────────────────────────────────────────────────────

function Build-Portable {
    Write-Step "8/9" "Gerando VERSÃO PORTÁTIL (.exe)..."
    Write-Info "Criando executável standalone..."
    Write-Host ""
    
    $startTime = Get-Date
    
    try {
        npx electron-builder build --win portable --x64 --config electron-builder.yml 2>&1 | ForEach-Object {
            if ($_ -match "error|fail") {
                Write-Host $_ -ForegroundColor Red
            }
            elseif ($_ -match "packaging|building|generating") {
                Write-Host "  $_" -ForegroundColor Gray
            }
        }
        
        $duration = ((Get-Date) - $startTime).TotalSeconds
        Write-Success "Versão portátil gerada em $([math]::Round($duration, 1))s"
    }
    catch {
        Write-Error "Erro ao gerar versão portátil: $_"
        exit 1
    }
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  RESUMO FINAL
# ─────────────────────────────────────────────────────────────────────────────

function Show-Summary {
    Write-Step "9/9" "Resumo do Build"
    Write-Host ""
    
    if (Test-Path $OUTPUT_DIR) {
        $files = Get-ChildItem -Path $OUTPUT_DIR -Filter "*.exe"
        
        if ($files.Count -gt 0) {
            Write-Host "ARQUIVOS GERADOS:" -ForegroundColor Green
            Write-Host ""
            
            foreach ($file in $files) {
                $size = [math]::Round($file.Length / 1MB, 2)
                $type = if ($file.Name -match "Setup") { "INSTALADOR" } else { "PORTÁTIL" }
                
                Write-Host "  [$type]" -ForegroundColor Cyan
                Write-Host "  📦 Nome: " -NoNewline
                Write-Host $file.Name -ForegroundColor Yellow
                Write-Host "  📏 Tamanho: " -NoNewline
                Write-Host "$size MB" -ForegroundColor White
                Write-Host "  📂 Caminho: " -NoNewline
                Write-Host $file.FullName -ForegroundColor Gray
                Write-Host ""
            }
            
            $totalSize = ($files | Measure-Object -Property Length -Sum).Sum / 1MB
            Write-Host "TOTAL: " -NoNewline -ForegroundColor White
            Write-Host "$([math]::Round($totalSize, 2)) MB em $($files.Count) arquivo(s)" -ForegroundColor Green
            
        }
        else {
            Write-Error "Nenhum executável foi gerado!"
            exit 1
        }
    }
    else {
        Write-Error "Diretório de saída não encontrado!"
        exit 1
    }
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  ✓ BUILD CONCLUÍDO COM SUCESSO!" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "PRÓXIMOS PASSOS:" -ForegroundColor Cyan
    Write-Host "  1. Teste o instalador em uma máquina limpa" -ForegroundColor White
    Write-Host "  2. Teste a versão portátil em diferentes sistemas" -ForegroundColor White
    Write-Host "  3. Distribua os executáveis para os usuários" -ForegroundColor White
    Write-Host ""
    Write-Host "SUPORTE: contato@aluforce.com" -ForegroundColor Gray
    Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════════════════
#  EXECUÇÃO PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

try {
    $totalStartTime = Get-Date
    
    Write-Header
    
    # 1. Verificar ambiente
    Test-Environment
    
    if ($OnlyCheck) {
        Write-Success "Ambiente verificado com sucesso!"
        exit 0
    }
    
    # 2. Limpar arquivos antigos
    Clear-BuildArtifacts
    
    # 3. Instalar dependências
    Install-Dependencies
    
    # 4. Verificar integridade
    Test-ProjectIntegrity
    
    # 5. Preparar assets
    Prepare-Assets
    
    # 6. Criar licença
    Create-License
    
    # 7. Build instalador
    Build-Installer
    
    # 8. Build portátil
    Build-Portable
    
    # 9. Mostrar resumo
    $totalDuration = ((Get-Date) - $totalStartTime).TotalMinutes
    Write-Host "Tempo total: $([math]::Round($totalDuration, 1)) minutos" -ForegroundColor Gray
    Write-Host ""
    
    Show-Summary
    
}
catch {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host "  ✗ ERRO NO BUILD" -ForegroundColor Red
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host ""
    Write-Host "Erro: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Stack Trace:" -ForegroundColor Yellow
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    Write-Host ""
    exit 1
}
