# ═══════════════════════════════════════════════════════════════════════════════
#  ALUFORCE ERP - Script de Build Profissional
#  Gera instalador NSIS para distribuição empresarial
# ═══════════════════════════════════════════════════════════════════════════════
#
# Uso:
#   .\build-installer.ps1              # Build padrão (instalador NSIS)
#   .\build-installer.ps1 -Portable    # Build versão portátil
#   .\build-installer.ps1 -All         # Build todas as versões
#   .\build-installer.ps1 -Clean       # Limpar e rebuildar
#
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [switch]$Portable,
    [switch]$All,
    [switch]$Clean,
    [switch]$SkipNodeModules
)

$ErrorActionPreference = "Stop"

# ─────────────────────────────────────────────────────────────────────────────
#  CONFIGURAÇÕES
# ─────────────────────────────────────────────────────────────────────────────

$APP_NAME = "ALUFORCE ERP"
$APP_VERSION = "2.2.0"
$BUILD_DIR = "dist-electron"
$ASSETS_DIR = "assets"

# Cores para output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) { Write-Output $args }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Header {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $APP_NAME - Build do Instalador v$APP_VERSION" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($step, $message) {
    Write-Host "[$step] " -ForegroundColor Yellow -NoNewline
    Write-Host $message -ForegroundColor White
}

function Write-Success($message) {
    Write-Host "  ✓ " -ForegroundColor Green -NoNewline
    Write-Host $message -ForegroundColor Gray
}

function Write-Error($message) {
    Write-Host "  ✗ " -ForegroundColor Red -NoNewline
    Write-Host $message -ForegroundColor Gray
}

function Write-Info($message) {
    Write-Host "  → " -ForegroundColor Blue -NoNewline
    Write-Host $message -ForegroundColor Gray
}

# ─────────────────────────────────────────────────────────────────────────────
#  VERIFICAÇÕES PRÉ-BUILD
# ─────────────────────────────────────────────────────────────────────────────

function Test-Prerequisites {
    Write-Step "1/6" "Verificando pré-requisitos..."
    
    # Node.js
    try {
        $nodeVersion = node -v
        Write-Success "Node.js encontrado: $nodeVersion"
    } catch {
        Write-Error "Node.js não encontrado! Instale em https://nodejs.org"
        exit 1
    }
    
    # NPM
    try {
        $npmVersion = npm -v
        Write-Success "NPM encontrado: v$npmVersion"
    } catch {
        Write-Error "NPM não encontrado!"
        exit 1
    }
    
    # package.json
    if (!(Test-Path "package.json")) {
        Write-Error "package.json não encontrado! Execute na raiz do projeto."
        exit 1
    }
    Write-Success "package.json encontrado"
    
    # Arquivos essenciais
    $essentialFiles = @("server.js", "electron/main.js", "electron/preload.js")
    foreach ($file in $essentialFiles) {
        if (!(Test-Path $file)) {
            Write-Error "Arquivo essencial não encontrado: $file"
            exit 1
        }
    }
    Write-Success "Arquivos essenciais verificados"
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  VERIFICAR ASSETS
# ─────────────────────────────────────────────────────────────────────────────

function Test-Assets {
    Write-Step "2/6" "Verificando assets..."
    
    if (!(Test-Path $ASSETS_DIR)) {
        New-Item -ItemType Directory -Path $ASSETS_DIR -Force | Out-Null
        Write-Info "Pasta assets criada"
    }
    
    # Verificar ícone
    $iconPath = Join-Path $ASSETS_DIR "icon.ico"
    if (!(Test-Path $iconPath)) {
        Write-Info "Ícone não encontrado. Verifique se existe: $iconPath"
        Write-Info "O build continuará, mas o instalador pode não ter ícone personalizado."
    } else {
        Write-Success "Ícone encontrado: $iconPath"
    }
    
    # Verificar sidebar do instalador (opcional)
    $sidebarPath = Join-Path $ASSETS_DIR "installer-sidebar.bmp"
    if (!(Test-Path $sidebarPath)) {
        Write-Info "Sidebar do instalador não encontrada (opcional)"
    } else {
        Write-Success "Sidebar do instalador encontrada"
    }
    
    # Verificar LICENSE
    if (!(Test-Path "LICENSE.txt")) {
        # Criar LICENSE básico se não existir
        $licenseContent = @"
ALUFORCE ERP - Sistema de Gestão Empresarial

Copyright (c) 2025 ALUFORCE Cabos Elétricos

Este software é propriedade da ALUFORCE Cabos Elétricos.
Todos os direitos reservados.

O uso deste software está sujeito aos termos do contrato de licença.
A redistribuição ou cópia não autorizada é proibida.
"@
        Set-Content -Path "LICENSE.txt" -Value $licenseContent -Encoding UTF8
        Write-Info "LICENSE.txt criado"
    } else {
        Write-Success "LICENSE.txt encontrado"
    }
    
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  INSTALAR DEPENDÊNCIAS
# ─────────────────────────────────────────────────────────────────────────────

function Install-Dependencies {
    Write-Step "3/6" "Verificando dependências..."
    
    if ($SkipNodeModules -and (Test-Path "node_modules")) {
        Write-Info "Pulando instalação de node_modules (--SkipNodeModules)"
    } else {
        if (!(Test-Path "node_modules") -or $Clean) {
            Write-Info "Instalando dependências (isso pode levar alguns minutos)..."
            npm install --omit=dev 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                npm install 2>&1 | Out-Null
            }
        }
    }
    
    # Verificar electron-builder
    $builderInstalled = npm list electron-builder 2>&1
    if ($builderInstalled -match "empty") {
        Write-Info "Instalando electron-builder..."
        npm install electron-builder --save-dev 2>&1 | Out-Null
    }
    
    Write-Success "Dependências verificadas"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  LIMPAR BUILD ANTERIOR
# ─────────────────────────────────────────────────────────────────────────────

function Clear-PreviousBuild {
    Write-Step "4/6" "Preparando diretório de build..."
    
    if ($Clean -and (Test-Path $BUILD_DIR)) {
        Write-Info "Removendo build anterior..."
        Remove-Item -Path $BUILD_DIR -Recurse -Force
    }
    
    if (!(Test-Path $BUILD_DIR)) {
        New-Item -ItemType Directory -Path $BUILD_DIR -Force | Out-Null
    }
    
    Write-Success "Diretório pronto: $BUILD_DIR"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  EXECUTAR BUILD
# ─────────────────────────────────────────────────────────────────────────────

function Start-Build {
    Write-Step "5/6" "Gerando instalador..."
    Write-Host ""
    
    $buildStart = Get-Date
    
    try {
        if ($All) {
            Write-Info "Gerando NSIS + Portable..."
            npm run build:all 2>&1
        } elseif ($Portable) {
            Write-Info "Gerando versão portátil..."
            npm run build:portable 2>&1
        } else {
            Write-Info "Gerando instalador NSIS..."
            npm run build:installer 2>&1
        }
        
        if ($LASTEXITCODE -ne 0) {
            throw "Erro no build (código: $LASTEXITCODE)"
        }
    } catch {
        Write-Host ""
        Write-Error "Falha no build: $_"
        Write-Host ""
        Write-Host "Possíveis soluções:" -ForegroundColor Yellow
        Write-Host "  1. Execute: npm install" -ForegroundColor Gray
        Write-Host "  2. Verifique se os assets existem" -ForegroundColor Gray
        Write-Host "  3. Verifique erros de sintaxe no código" -ForegroundColor Gray
        exit 1
    }
    
    $buildEnd = Get-Date
    $buildTime = ($buildEnd - $buildStart).TotalSeconds
    
    Write-Host ""
    Write-Success "Build concluído em $([math]::Round($buildTime, 1)) segundos"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  RESUMO FINAL
# ─────────────────────────────────────────────────────────────────────────────

function Show-Summary {
    Write-Step "6/6" "Resumo do build..."
    Write-Host ""
    
    $installers = Get-ChildItem -Path $BUILD_DIR -Filter "*.exe" -ErrorAction SilentlyContinue
    
    if ($installers.Count -gt 0) {
        Write-Host "  Arquivos gerados:" -ForegroundColor Green
        Write-Host ""
        
        foreach ($file in $installers) {
            $size = [math]::Round($file.Length / 1MB, 2)
            Write-Host "    📦 " -NoNewline
            Write-Host $file.Name -ForegroundColor White -NoNewline
            Write-Host " ($size MB)" -ForegroundColor Gray
        }
        
        Write-Host ""
        Write-Host "  Localização: " -ForegroundColor Cyan -NoNewline
        Write-Host (Resolve-Path $BUILD_DIR).Path -ForegroundColor White
        Write-Host ""
        
        # Abrir pasta do build
        $openFolder = Read-Host "  Abrir pasta do instalador? (S/n)"
        if ($openFolder -ne "n" -and $openFolder -ne "N") {
            Start-Process "explorer.exe" -ArgumentList (Resolve-Path $BUILD_DIR).Path
        }
    } else {
        Write-Error "Nenhum instalador foi gerado!"
        Write-Info "Verifique os logs acima para erros."
    }
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Build finalizado!" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────

Write-Header
Test-Prerequisites
Test-Assets
Install-Dependencies
Clear-PreviousBuild
Start-Build
Show-Summary
