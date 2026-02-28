# ========================================
# ALUFORCE - Sincronizacao em Tempo Real V3
# ========================================
# Monitora alteracoes e sincroniza automaticamente com VPS
# Corrigido para /var/www/aluforce-v2/

param(
    [switch]$SkipServer = $false
)

$ErrorActionPreference = "Continue"

# Configuracoes
$env:PATH += ";C:\Program Files\PuTTY"
$serverPassword = "Aluforce@2026#Vps"
$serverUser = "root"
$serverIP = "31.97.64.102"
$serverPath = "/var/www/aluforce-v2"
$localPath = $PSScriptRoot

# Cores
$cTitle   = "Cyan"
$cSuccess = "Green"
$cWarning = "Yellow"
$cError   = "Red"
$cInfo    = "White"
$cGray    = "Gray"

# Banner
Clear-Host
Write-Host ""
Write-Host "====================================================" -ForegroundColor $cTitle
Write-Host "    ALUFORCE - Sincronizacao Tempo Real V3           " -ForegroundColor $cTitle
Write-Host "====================================================" -ForegroundColor $cTitle
Write-Host ""
Write-Host "Servidor: $serverUser@$serverIP" -ForegroundColor $cWarning
Write-Host "VPS Path: $serverPath" -ForegroundColor $cWarning
Write-Host "Local:    $localPath" -ForegroundColor $cWarning
Write-Host ""

# Verificar PuTTY/PSCP
if (-not (Get-Command pscp.exe -ErrorAction SilentlyContinue)) {
    Write-Host "ERRO: PSCP nao encontrado! Instale PuTTY." -ForegroundColor $cError
    pause
    exit 1
}

# Pastas e extensoes a monitorar
$foldersToWatch = @(
    "modules",
    "src",
    "public",
    "css",
    "js",
    "routes",
    "api",
    "middleware",
    "services",
    "dashboard-emergent"
)

$validExts = @(".html", ".js", ".css", ".json", ".ejs")

# Estatisticas
$script:uploadCount = 0
$script:errorCount = 0
$startTime = Get-Date

# Funcao de log
function Write-Log {
    param([string]$Msg, [string]$Color = "White")
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -NoNewline -ForegroundColor $cGray
    Write-Host $Msg -ForegroundColor $Color
}

# Funcao de upload
function Upload-File {
    param([string]$localFile, [int]$MaxRetries = 3)

    if (-not (Test-Path $localFile)) {
        Write-Log "Arquivo nao existe: $localFile" $cError
        return $false
    }

    $relativePath = $localFile.Replace($localPath, "").Replace("\", "/")
    $remotePath = $serverPath + $relativePath
    $remoteDir = $remotePath.Substring(0, $remotePath.LastIndexOf("/"))

    Write-Log "Enviando: $relativePath" $cInfo

    for ($i = 1; $i -le $MaxRetries; $i++) {
        try {
            # Criar diretorio remoto
            & plink -batch -pw $serverPassword "$serverUser@$serverIP" "mkdir -p '$remoteDir'" 2>&1 | Out-Null

            # Upload
            & pscp -pw $serverPassword -batch $localFile "$serverUser@${serverIP}:${remotePath}" 2>&1 | Out-Null

            if ($LASTEXITCODE -eq 0) {
                $script:uploadCount++
                Write-Log "OK: $relativePath" $cSuccess

                # Reiniciar PM2 se for server.js ou arquivo critico
                if ($localFile -match "server\.js$") {
                    Write-Log "Reiniciando servidor..." $cWarning
                    & plink -batch -pw $serverPassword "$serverUser@$serverIP" "cd $serverPath && pm2 restart aluforce-dashboard" 2>&1 | Out-Null
                    Write-Log "Servidor reiniciado" $cSuccess
                }

                return $true
            }
        }
        catch {
            Write-Log "Tentativa $i falhou: $_" $cError
        }

        if ($i -lt $MaxRetries) {
            Start-Sleep -Seconds 2
        }
    }

    $script:errorCount++
    Write-Log "FALHA: $relativePath apos $MaxRetries tentativas" $cError
    return $false
}

# Criar watchers
$watchers = @()

# === Watcher para arquivos raiz ===
try {
    $rootWatcher = New-Object System.IO.FileSystemWatcher
    $rootWatcher.Path = $localPath
    $rootWatcher.IncludeSubdirectories = $false
    $rootWatcher.EnableRaisingEvents = $true
    $rootWatcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName
    $rootWatcher.Filter = "*.*"

    $rootAction = {
        $filePath = $Event.SourceEventArgs.FullPath
        $fileExt = [System.IO.Path]::GetExtension($filePath)
        if ($fileExt -in @(".html", ".js", ".css", ".json")) {
            Start-Sleep -Milliseconds 500
            if (Test-Path $filePath) {
                Upload-File $filePath
            }
        }
    }

    Register-ObjectEvent $rootWatcher "Changed" -Action $rootAction | Out-Null
    Register-ObjectEvent $rootWatcher "Created" -Action $rootAction | Out-Null
    $watchers += $rootWatcher
    Write-Log "Monitorando: raiz - server.js, login.html" $cSuccess
}
catch {
    Write-Log "Erro ao criar watcher raiz: $_" $cError
}

# === Watchers para subpastas ===
foreach ($folder in $foldersToWatch) {
    $fullPath = Join-Path $localPath $folder

    if (-not (Test-Path $fullPath)) {
        Write-Log "Pasta nao existe: $folder" $cWarning
        continue
    }

    try {
        $watcher = New-Object System.IO.FileSystemWatcher
        $watcher.Path = $fullPath
        $watcher.IncludeSubdirectories = $true
        $watcher.EnableRaisingEvents = $true
        $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName

        $action = {
            $filePath = $Event.SourceEventArgs.FullPath
            $fileExt = [System.IO.Path]::GetExtension($filePath)
            if ($fileExt -in @(".html", ".js", ".css", ".json", ".ejs")) {
                Start-Sleep -Milliseconds 500
                if (Test-Path $filePath) {
                    Upload-File $filePath
                }
            }
        }

        Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
        Register-ObjectEvent $watcher "Created" -Action $action | Out-Null
        Register-ObjectEvent $watcher "Renamed" -Action $action | Out-Null

        $watchers += $watcher
        Write-Log "Monitorando: $folder" $cSuccess
    }
    catch {
        Write-Log "Erro ao criar watcher para ${folder}: $_" $cError
    }
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor $cSuccess
Write-Host "           SINCRONIZACAO ATIVA!                      " -ForegroundColor $cSuccess
Write-Host "====================================================" -ForegroundColor $cSuccess
Write-Host ""
Write-Host "Edite arquivos e veja upload automatico" -ForegroundColor $cInfo
Write-Host "Pressione 's' para ver estatisticas" -ForegroundColor $cInfo
Write-Host "Pressione Ctrl+C para parar" -ForegroundColor $cWarning
Write-Host ""

# Loop principal
try {
    while ($true) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.KeyChar -eq 's') {
                $elapsed = (Get-Date) - $startTime
                $elapsedStr = "{0:hh\:mm\:ss}" -f $elapsed
                Write-Host ""
                Write-Host "=== ESTATISTICAS ===" -ForegroundColor $cTitle
                Write-Host "Tempo ativo: $elapsedStr" -ForegroundColor $cInfo
                Write-Host "Uploads: $($script:uploadCount)" -ForegroundColor $cSuccess
                Write-Host "Erros: $($script:errorCount)" -ForegroundColor $cError
                Write-Host "====================" -ForegroundColor $cTitle
                Write-Host ""
            }
        }
        Start-Sleep -Milliseconds 500
    }
}
finally {
    Write-Host ""
    Write-Log "Encerrando sincronizacao..." $cWarning

    foreach ($w in $watchers) {
        $w.EnableRaisingEvents = $false
        $w.Dispose()
    }

    Get-EventSubscriber | Unregister-Event -Force

    $elapsed = (Get-Date) - $startTime
    $elapsedStr = "{0:hh\:mm\:ss}" -f $elapsed
    Write-Host ""
    Write-Host "=== RESUMO FINAL ===" -ForegroundColor $cTitle
    Write-Host "Tempo total: $elapsedStr" -ForegroundColor $cInfo
    Write-Host "Total uploads: $($script:uploadCount)" -ForegroundColor $cSuccess
    Write-Host "Total erros: $($script:errorCount)" -ForegroundColor $cError
    Write-Host "====================" -ForegroundColor $cTitle
    Write-Host ""
    Write-Log "Sincronizacao encerrada." $cSuccess
}
