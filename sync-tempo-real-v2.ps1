# ========================================
# ALUFORCE - Sistema de Sincronização em Tempo Real
# ========================================
# Monitora alterações e sincroniza automaticamente com VPS

param(
    [switch]$SkipServer = $false
)

$ErrorActionPreference = "Continue"

# Configurações
$env:PATH += ";C:\Program Files\PuTTY"
$serverPassword = "Aluforce@2026#Vps"
$serverUser = "root"
$serverIP = "31.97.64.102"
$serverPath = "/var/www/aluforce-v2"
$localPath = "g:\.shortcut-targets-by-id\1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN\Sistema - ALUFORCE - V.2"

# Cores
$colors = @{
    Title   = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error   = "Red"
    Info    = "White"
    Gray    = "Gray"
}

# Banner
Clear-Host
Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor $colors.Title
Write-Host "║    ALUFORCE - Sincronização Tempo Real        ║" -ForegroundColor $colors.Title
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor $colors.Title
Write-Host ""
Write-Host "📡 Servidor: " -NoNewline -ForegroundColor $colors.Info
Write-Host "$serverUser@$serverIP" -ForegroundColor $colors.Warning
Write-Host "📁 Local: " -NoNewline -ForegroundColor $colors.Info
Write-Host "$localPath" -ForegroundColor $colors.Warning
Write-Host ""

# Verificar PuTTY/PSCP
if (-not (Get-Command pscp.exe -ErrorAction SilentlyContinue)) {
    Write-Host "❌ ERRO: PSCP não encontrado!" -ForegroundColor $colors.Error
    Write-Host "   Instale PuTTY ou adicione ao PATH" -ForegroundColor $colors.Warning
    pause
    exit 1
}

# Pastas e extensões a monitorar
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

$extensions = @(".html", ".js", ".css", ".json", ".ejs")

# Estatísticas
$stats = @{
    Uploads   = 0
    Errors    = 0
    StartTime = Get-Date
}

# Função de log com timestamp
function Write-Log {
    param(
        [string]$Message,
        [string]$Type = "Info"
    )

    $timestamp = Get-Date -Format "HH:mm:ss"
    $color = $colors[$Type]

    Write-Host "[$timestamp] " -NoNewline -ForegroundColor $colors.Gray
    Write-Host $Message -ForegroundColor $color
}

# Função de upload com retry
function Upload-File {
    param(
        [string]$localFile,
        [int]$MaxRetries = 3
    )

    if (-not (Test-Path $localFile)) {
        Write-Log "Arquivo não existe: $localFile" "Error"
        return $false
    }

    $relativePath = $localFile.Replace($localPath, "").Replace("\", "/")
    $remotePath = "$serverPath$relativePath"
    $remoteDir = Split-Path -Parent $remotePath

    Write-Log "📤 Enviando: $relativePath" "Info"

    # Tentar upload com retry
    for ($i = 1; $i -le $MaxRetries; $i++) {
        try {
            # Criar diretório remoto se necessário
            $mkdirCmd = "mkdir -p '$remoteDir'"
            & plink -batch -pw $serverPassword "${serverUser}@${serverIP}" $mkdirCmd 2>&1 | Out-Null

            # Upload do arquivo
            $result = & pscp -pw $serverPassword -batch $localFile "${serverUser}@${serverIP}:${remotePath}" 2>&1

            if ($LASTEXITCODE -eq 0) {
                $script:stats.Uploads++
                Write-Log "✅ OK: $relativePath" "Success"

                # Reiniciar PM2 se for arquivo crítico
                if ($localFile -match "server\.js|routes|api|middleware") {
                    Write-Log "🔄 Reiniciando servidor..." "Warning"
                    & plink -batch -pw $serverPassword "${serverUser}@${serverIP}" "cd $serverPath && pm2 restart aluforce-dashboard" 2>&1 | Out-Null
                }

                return $true
            }
        }
        catch {
            Write-Log "Tentativa $i falhou: $_" "Error"
        }

        if ($i -lt $MaxRetries) {
            Start-Sleep -Seconds 2
        }
    }

    $script:stats.Errors++
    Write-Log "❌ FALHA: $relativePath (após $MaxRetries tentativas)" "Error"
    return $false
}

# Criar watchers
$watchers = @()

# === Watcher para arquivos raiz (server.js, login.html, etc) ===
try {
    $rootWatcher = New-Object System.IO.FileSystemWatcher
    $rootWatcher.Path = $localPath
    $rootWatcher.IncludeSubdirectories = $false
    $rootWatcher.EnableRaisingEvents = $true
    $rootWatcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName
    $rootWatcher.Filter = "*.*"

    $rootAction = {
        $path = $Event.SourceEventArgs.FullPath
        $ext = [System.IO.Path]::GetExtension($path)
        if ($ext -in @(".html", ".js", ".css", ".json")) {
            Start-Sleep -Milliseconds 500
            if (Test-Path $path) {
                Upload-File $path
            }
        }
    }

    Register-ObjectEvent $rootWatcher "Changed" -Action $rootAction | Out-Null
    Register-ObjectEvent $rootWatcher "Created" -Action $rootAction | Out-Null
    $watchers += $rootWatcher
    Write-Log "✓ Monitorando: raiz (server.js, login.html, etc)" "Success"
}
catch {
    Write-Log "Erro ao criar watcher raiz: $_" "Error"
}

# === Watchers para subpastas ===
foreach ($folder in $foldersToWatch) {
    $fullPath = Join-Path $localPath $folder

    if (-not (Test-Path $fullPath)) {
        Write-Log "⚠️  Pasta não existe: $folder" "Warning"
        continue
    }

    try {
        $watcher = New-Object System.IO.FileSystemWatcher
        $watcher.Path = $fullPath
        $watcher.IncludeSubdirectories = $true
        $watcher.EnableRaisingEvents = $true
        $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName

        # Event handler
        $action = {
            $path = $Event.SourceEventArgs.FullPath
            $changeType = $Event.SourceEventArgs.ChangeType
            $ext = [System.IO.Path]::GetExtension($path)

            # Filtrar extensões relevantes
            if ($ext -in @(".html", ".js", ".css", ".json", ".ejs")) {
                # Aguardar arquivo ser liberado
                Start-Sleep -Milliseconds 500

                # Verificar se arquivo ainda existe (pode ter sido deletado)
                if (Test-Path $path) {
                    Upload-File $path
                }
            }
        }

        # Registrar eventos
        Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
        Register-ObjectEvent $watcher "Created" -Action $action | Out-Null
        Register-ObjectEvent $watcher "Renamed" -Action $action | Out-Null

        $watchers += $watcher
        Write-Log "✓ Monitorando: $folder" "Success"

    }
    catch {
        Write-Log "Erro ao criar watcher para $folder : $_" "Error"
    }
}

Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor $colors.Success
Write-Host "║           SINCRONIZAÇÃO ATIVA!                 ║" -ForegroundColor $colors.Success
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor $colors.Success
Write-Host ""
Write-Host "💡 Edite arquivos e veja upload automático" -ForegroundColor $colors.Info
Write-Host "📊 Estatísticas: Pressione 's' para ver" -ForegroundColor $colors.Info
Write-Host "❌ Parar: Pressione Ctrl+C" -ForegroundColor $colors.Warning
Write-Host ""

# Loop principal com estatísticas
try {
    while ($true) {
        # Verificar se usuário pressionou 's'
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.KeyChar -eq 's') {
                $elapsed = (Get-Date) - $stats.StartTime
                Write-Host ""
                Write-Host "═══ ESTATÍSTICAS ═══" -ForegroundColor $colors.Title
                Write-Host "⏱️  Tempo ativo: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor $colors.Info
                Write-Host "✅ Uploads: $($stats.Uploads)" -ForegroundColor $colors.Success
                Write-Host "❌ Erros: $($stats.Errors)" -ForegroundColor $colors.Error
                Write-Host "═══════════════════" -ForegroundColor $colors.Title
                Write-Host ""
            }
        }

        Start-Sleep -Milliseconds 500
    }
}
finally {
    # Cleanup
    Write-Host ""
    Write-Log "Encerrando sincronização..." "Warning"

    foreach ($watcher in $watchers) {
        $watcher.EnableRaisingEvents = $false
        $watcher.Dispose()
    }

    Get-EventSubscriber | Unregister-Event -Force

    $elapsed = (Get-Date) - $stats.StartTime
    Write-Host ""
    Write-Host "═══ RESUMO FINAL ═══" -ForegroundColor $colors.Title
    Write-Host "⏱️  Tempo total: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor $colors.Info
    Write-Host "✅ Total uploads: $($stats.Uploads)" -ForegroundColor $colors.Success
    Write-Host "❌ Total erros: $($stats.Errors)" -ForegroundColor $colors.Error
    Write-Host "════════════════════" -ForegroundColor $colors.Title
    Write-Host ""
    Write-Log "Sincronização encerrada." "Success"
}
