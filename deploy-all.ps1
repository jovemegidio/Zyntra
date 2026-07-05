#!/usr/bin/env pwsh

param(
    [string]$Message = "",
    [switch]$SkipVPS,
    [switch]$SkipBranches,
    [switch]$SkipGit,
    [switch]$SkipBackup,
    [string]$SinceRef = "HEAD~1",
    [string]$Password = $env:ZYNTRA_VPS_PASSWORD
)

$ErrorActionPreference = "Stop"

$PROJECT_ROOT = $PSScriptRoot
$VPS_HOST = "root@31.97.64.102"
$SSH_KEY = Join-Path $env:USERPROFILE ".ssh\id_ed25519_vps"
$REMOTE_DOMAIN = "aluforce.api.br"
$REMOTE_BACKUP_DIR = "/var/www/backups"

$FULL_BASES = @(
    "Base/Labor Eletric/Sistema",
    "Base/Labor Energy/Sistema"
)

$PARTIAL_BASES = @(
    "Base/Demo",
    "Base/Comercio",
    "Base/Servicos",
    "Base/Agropecuario",
    "Base/Industria"
)

$SYSTEM_FILES = @(
    "server.js",
    "routes/index.js",
    "routes/static-routes.js",
    "routes/auth-rbac.js",
    "routes/auth-section-routes.js",
    "routes/misc-routes.js",
    "routes/chat-routes.js",
    "routes/financeiro-core.js",
    "middleware/zyntra-branding.js",
    "_shared/confirm-dialog.js",
    "_shared/accessibility-widget.js",
    "modules/_shared/accessibility-widget.js",
    "public/login.html",
    "public/js/login.js",
    "public/js/auth-unified.js",
    "public/js/header-controls.js",
    "public/js/layout-component.js",
    "public/js/script.js",
    "public/js/permissions-api.js",
    "public/js/pwa-manager.js",
    "public/js/preferences-manager.js",
    "public/js/permissions.js",
    "public/js/permissions-v2.js",
    "public/js/dashboard-executivo.js",
    "public/js/dashboard-enhanced.js",
    "public/js/kpis-executivo.js",
    "public/js/aluforce-turbo.js",
    "public/js/ios-native-bridge.js",
    "public/js/config-modals.js",
    "public/config-modals.html",
    "public/config-modals-extended.html",
    "public/modal-configuracoes-content.html",
    "modules/_shared/header-functions.js",
    "modules/_shared/pcp-standard.js",
    "Empresas/aluforce/painel.html",
    "Empresas/energy/painel.html",
    "Empresas/labor-energy/painel.html",
    "public/chat-teams/chat-widget.js",
    "public/chat-teams/chat-widget.css",
    "public/chat/widget.js",
    "modules/Compras/api/cotacoes.js",
    "modules/Compras/api/estoque.js",
    "modules/Compras/api/fornecedores.js",
    "modules/Compras/api/relatorios.js",
    "modules/Compras/cotacoes.js",
    "modules/Compras/fornecedores.html",
    "modules/Compras/fornecedores.js",
    "modules/Compras/relatorios.html",
    "modules/Compras/index.html",
    "modules/Financeiro/index.html",
    "modules/Logistica/public/index.html",
    "modules/Vendas/index.html",
    ".eslintrc.json",
    "package.json",
    "package-lock.json"
)

$SYSTEM_DIRECTORIES = @(
    "public/css",
    "public/js",
    "public/images",
    "public/logos",
    "public/relatorios"
)

$REMOTE_APPS = @(
    [pscustomobject]@{
        Name = "aluforce"
        LocalPrefix = ""
        RemoteRoot = "/var/www/aluforce"
        Pm2Name = "aluforce-v2-production"
        HealthPath = "/api/health"
    },
    [pscustomobject]@{
        Name = "labor-energy"
        LocalPrefix = "Base/Labor Energy/Sistema/"
        RemoteRoot = "/var/www/labor-energy"
        Pm2Name = "labor-energy-demo"
        HealthPath = "/labor-energy/api/health"
    },
    [pscustomobject]@{
        Name = "labor-eletric"
        LocalPrefix = "Base/Labor Eletric/Sistema/"
        RemoteRoot = "/var/www/labor-eletric"
        Pm2Name = "labor-eletric-demo"
        HealthPath = "/labor-eletric/api/health"
    },
    [pscustomobject]@{
        Name = "zyntra-ramos"
        LocalPrefix = "Base/Ramos/"
        RemoteRoot = "/var/www/zyntra-ramos"
        Pm2Name = "zyntra-ramos"
        Pm2Config = "ecosystem.ramos.config.js"
        HealthPath = "/ramos/api/health"
    }
)

$REMOTE_APP_INDEX = @{}
foreach ($app in $REMOTE_APPS) {
    $REMOTE_APP_INDEX[$app.Name] = $app
}

function Write-Step {
    param([string]$Text)
    Write-Host "`n[STEP] $Text" -ForegroundColor Cyan
}

function Write-OK {
    param([string]$Text)
    Write-Host "  [OK] $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "  [WARN] $Text" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Text)
    Write-Host "  [ERR] $Text" -ForegroundColor Red
}

function Resolve-ToolPath {
    param(
        [Parameter(Mandatory)][string]$CommandName,
        [string[]]$CandidatePaths = @()
    )

    foreach ($candidate in $CandidatePaths) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

$UsePasswordAuth = $false
$PLINK_EXE = $null
$PSCP_EXE = $null
$SSH_EXE = $null
$SCP_EXE = $null

if (-not $SkipVPS) {
    $PLINK_EXE = Resolve-ToolPath -CommandName "plink.exe" -CandidatePaths @(
        "C:\Program Files\PuTTY\plink.exe",
        "C:\Program Files (x86)\PuTTY\plink.exe"
    )
    $PSCP_EXE = Resolve-ToolPath -CommandName "pscp.exe" -CandidatePaths @(
        "C:\Program Files\PuTTY\pscp.exe",
        "C:\Program Files (x86)\PuTTY\pscp.exe"
    )
    $SSH_EXE = Resolve-ToolPath -CommandName "ssh.exe"
    $SCP_EXE = Resolve-ToolPath -CommandName "scp.exe"

    if ($Password) {
        if ($PLINK_EXE -and $PSCP_EXE) {
            $UsePasswordAuth = $true
            Write-OK "Autenticacao por senha habilitada via PuTTY"
        } else {
            Write-Warn "Senha informada, mas plink/pscp nao foram encontrados. Seguindo com chave SSH."
        }
    }

    if (-not $UsePasswordAuth) {
        if (-not $SSH_EXE -or -not $SCP_EXE) {
            throw "Nao encontrei ssh.exe/scp.exe para deploy com chave."
        }
        if (-not (Test-Path $SSH_KEY)) {
            throw "Chave SSH nao encontrada em $SSH_KEY"
        }
    }
}

function Invoke-Remote {
    param(
        [Parameter(Mandatory)][string]$Command,
        [switch]$IgnoreExitCode
    )

    $output = if ($script:UsePasswordAuth) {
        & $script:PLINK_EXE -ssh -batch -pw $script:Password -hostkey "SHA256:Vx3srqWWuA4yoXk/UytkTZp/aR210QKKF2BxYpgZZww" $script:VPS_HOST $Command
    } else {
        & $script:SSH_EXE -i $script:SSH_KEY -o StrictHostKeyChecking=no $script:VPS_HOST $Command
    }

    $exitCode = $LASTEXITCODE
    if (-not $IgnoreExitCode -and $exitCode -ne 0) {
        throw "Comando remoto falhou com codigo ${exitCode}: $Command"
    }

    return $output
}

function Copy-ToRemote {
    param(
        [Parameter(Mandatory)][string]$LocalPath,
        [Parameter(Mandatory)][string]$RemotePath
    )

    if ($script:UsePasswordAuth) {
        & $script:PSCP_EXE -batch -pw $script:Password -hostkey "SHA256:Vx3srqWWuA4yoXk/UytkTZp/aR210QKKF2BxYpgZZww" $LocalPath "$($script:VPS_HOST):$RemotePath" | Out-Null
    } else {
        & $script:SCP_EXE -i $script:SSH_KEY -o StrictHostKeyChecking=no $LocalPath "$($script:VPS_HOST):$RemotePath" | Out-Null
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao enviar $LocalPath para $RemotePath"
    }
}

function Test-GitRef {
    param([Parameter(Mandatory)][string]$Ref)

    & git rev-parse --verify $Ref 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Add-FilesToSet {
    param(
        [System.Collections.Generic.HashSet[string]]$Set,
        [string[]]$Values
    )

    foreach ($value in $Values) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $normalized = $value.Trim()
        if ($normalized) {
            [void]$Set.Add($normalized)
        }
    }
}

function Add-GitStatusFiles {
    param(
        [System.Collections.Generic.HashSet[string]]$Set,
        [string[]]$StatusLines
    )

    foreach ($line in $StatusLines) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) {
            continue
        }

        $path = $line.Substring(3).Trim()
        if ($path.Contains(" -> ")) {
            $path = ($path -split " -> ")[-1]
        }
        if ($path.StartsWith('"') -and $path.EndsWith('"')) {
            $path = $path.Trim('"')
        }

        if ($path) {
            [void]$Set.Add($path)
        }
    }
}

function Get-ChangedFiles {
    $files = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    Add-FilesToSet -Set $files -Values (& git diff --name-only -- 2>$null)
    Add-FilesToSet -Set $files -Values (& git diff --name-only --cached -- 2>$null)
    Add-FilesToSet -Set $files -Values (& git ls-files --others --exclude-standard 2>$null)

    if (Test-GitRef -Ref $SinceRef) {
        Add-FilesToSet -Set $files -Values (& git diff --name-only $SinceRef -- 2>$null)
    }

    if ($files.Count -eq 0) {
        Add-GitStatusFiles -Set $files -StatusLines (& git status --porcelain=v1 --untracked-files=all 2>$null)
    }

    if ($files.Count -eq 0) {
        $recentFiles = Get-ChildItem -Path $PROJECT_ROOT -Recurse -File |
            Where-Object {
                $_.LastWriteTime -gt (Get-Date).AddMinutes(-30) -and
                $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\logs\\|\\uploads\\|\\backups\\|\\_Zyntra_Legacy\\|\\test-results\\'
            } |
            ForEach-Object {
                $_.FullName.Replace("$PROJECT_ROOT\", "").Replace("\", "/")
            }

        Add-FilesToSet -Set $files -Values $recentFiles
    }

    return @($files) | Sort-Object
}

function Test-DeployablePath {
    param([Parameter(Mandatory)][string]$RelativePath)

    $normalized = $RelativePath.Replace("\", "/")
    # Excluir scripts de debug/utilitário, bytecode Python e diretórios não-produtivos
    if ($normalized -match '\.(py|pyc|sh)$') { return $false }
    if ($normalized -match '^_') { return $false }
    if ($normalized -match '^(AUDITORIA|__pycache__)') { return $false }
    if ($normalized -match '(^|/)(node_modules|\.git|logs|uploads|backups|test-results|storage)(/|$)') { return $false }
    return ($normalized -notmatch '^(node_modules|\.git|logs/|uploads/|backups/|backup-|_Zyntra_Legacy/|test-results/|storage/)')
}

function Resolve-AppTarget {
    param([Parameter(Mandatory)][string]$RelativePath)

    $normalized = $RelativePath.Replace("\", "/")

    if ($normalized -match '^Base/Ramos/(.+)$') {
        return [pscustomobject]@{
            AppName = "zyntra-ramos"
            RelativeRemotePath = $Matches[1]
            LocalPath = $normalized
        }
    }

    if ($normalized -match '^Base/Labor Energy/Sistema/(.+)$') {
        return [pscustomobject]@{
            AppName = "labor-energy"
            RelativeRemotePath = $Matches[1]
            LocalPath = $normalized
        }
    }

    if ($normalized -match '^Base/Labor Eletric/Sistema/(.+)$') {
        return [pscustomobject]@{
            AppName = "labor-eletric"
            RelativeRemotePath = $Matches[1]
            LocalPath = $normalized
        }
    }

    if ($normalized.StartsWith("Base/")) {
        return $null
    }

    return [pscustomobject]@{
        AppName = "aluforce"
        RelativeRemotePath = $normalized
        LocalPath = $normalized
    }
}

function Sync-Branches {
    Write-Step "Sincronizando bases locais"

    foreach ($base in $FULL_BASES) {
        $synced = 0

        foreach ($file in $SYSTEM_FILES) {
            $source = Join-Path $PROJECT_ROOT $file
            $target = Join-Path $PROJECT_ROOT (Join-Path $base $file)

            if (-not (Test-Path $source -PathType Leaf)) {
                continue
            }

            $targetDir = Split-Path $target -Parent
            if (-not (Test-Path $targetDir)) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            }

            Copy-Item $source $target -Force
            $synced++
        }

        foreach ($directory in $SYSTEM_DIRECTORIES) {
            $sourceDir = Join-Path $PROJECT_ROOT $directory
            $targetDir = Join-Path $PROJECT_ROOT (Join-Path $base $directory)

            if (-not (Test-Path $sourceDir -PathType Container)) {
                continue
            }

            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            Copy-Item (Join-Path $sourceDir "*") $targetDir -Recurse -Force
        }

        Write-OK "$base <= $synced arquivos"
    }

    foreach ($base in $PARTIAL_BASES) {
        $synced = 0

        foreach ($file in $SYSTEM_FILES) {
            $source = Join-Path $PROJECT_ROOT $file
            $target = Join-Path $PROJECT_ROOT (Join-Path $base $file)
            $targetDir = Split-Path $target -Parent

            if ((Test-Path $source -PathType Leaf) -and (Test-Path $targetDir)) {
                Copy-Item $source $target -Force
                $synced++
            }
        }

        foreach ($directory in $SYSTEM_DIRECTORIES) {
            $sourceDir = Join-Path $PROJECT_ROOT $directory
            $targetDir = Join-Path $PROJECT_ROOT (Join-Path $base $directory)

            if ((Test-Path $sourceDir -PathType Container) -and (Test-Path (Split-Path $targetDir -Parent))) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
                Copy-Item (Join-Path $sourceDir "*") $targetDir -Recurse -Force
            }
        }

        if ($synced -gt 0) {
            Write-OK "$base <= $synced arquivos"
        }
    }
}

function Invoke-GitStep {
    param([string[]]$DeployFiles)

    Write-Step "Git commit + push"
    Set-Location $PROJECT_ROOT

    & git add -A
    $status = & git status --porcelain=v1

    if (-not $status) {
        Write-OK "Nenhuma alteracao para commit"
        return
    }

    if (-not $Message) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        $count = if ($DeployFiles) { $DeployFiles.Count } else { ($status | Measure-Object).Count }
        $script:Message = "deploy: $count arquivos atualizados em $timestamp"
    }

    & git commit -m $script:Message
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no git commit"
    }
    Write-OK "Commit criado: $script:Message"

    & git push origin main
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Push concluido"
    } else {
        Write-Warn "Push falhou; seguindo sem interromper o deploy"
    }
}

function Group-DeployFiles {
    param([string[]]$Files)

    $groups = @{}
    $seen = @{}

    foreach ($app in $REMOTE_APPS) {
        $groups[$app.Name] = [System.Collections.Generic.List[object]]::new()
        $seen[$app.Name] = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    }

    foreach ($file in $Files) {
        if (-not (Test-DeployablePath -RelativePath $file)) {
            continue
        }

        $target = Resolve-AppTarget -RelativePath $file
        if (-not $target) {
            continue
        }

        $localPath = Join-Path $PROJECT_ROOT ($target.LocalPath.Replace("/", "\"))
        try {
            if (-not (Test-Path $localPath -PathType Leaf)) { continue }
        } catch {
            Write-Warn "Ignorando caminho invalido: $localPath"
            continue
        }

        if ($seen[$target.AppName].Contains($target.RelativeRemotePath)) {
            continue
        }

        [void]$seen[$target.AppName].Add($target.RelativeRemotePath)
        $app = $REMOTE_APP_INDEX[$target.AppName]
        $groups[$target.AppName].Add([pscustomobject]@{
            Source = $localPath
            RelativePath = $target.RelativeRemotePath
            RemotePath = "$($app.RemoteRoot)/$($target.RelativeRemotePath)"
        })
    }

    return $groups
}

function Backup-RemoteApps {
    param([string[]]$AppNames)

    Write-Step "Criando backup remoto"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupMap = @{}
    $commands = @("mkdir -p '$REMOTE_BACKUP_DIR'")

    foreach ($appName in $AppNames) {
        $app = $REMOTE_APP_INDEX[$appName]
        $backupPath = "$REMOTE_BACKUP_DIR/$appName-predeploy-$timestamp.tar.gz"
        $backupMap[$appName] = $backupPath
        # Exclui node_modules, uploads, logs e backups para backup leve (só código)
        $commands += "if [ -d '$($app.RemoteRoot)' ]; then tar -czf '$backupPath' -C '$($app.RemoteRoot)' --exclude='./node_modules' --exclude='./uploads' --exclude='./logs' --exclude='./storage' --exclude='./.git' .; else mkdir -p '$($app.RemoteRoot)' && tar -czf '$backupPath' --files-from /dev/null; fi"
    }

    Invoke-Remote -Command ($commands -join " && ") | Out-Null

    foreach ($appName in $AppNames) {
        Write-OK "$appName => $($backupMap[$appName])"
    }

    return $backupMap
}

function Upload-AppFiles {
    param(
        [Parameter(Mandatory)][string]$AppName,
        [Parameter(Mandatory)][System.Collections.Generic.List[object]]$Items
    )

    if ($Items.Count -eq 0) {
        return $false
    }

    $remoteDirs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $Items) {
        $remoteDir = ($item.RemotePath -replace '/[^/]+$', '')
        [void]$remoteDirs.Add($remoteDir)
    }

    if ($remoteDirs.Count -gt 0) {
        $mkdirCommand = (@($remoteDirs) | Sort-Object | ForEach-Object { "mkdir -p '$_'" }) -join " && "
        Invoke-Remote -Command $mkdirCommand | Out-Null
    }

    $uploaded = 0
    $needsInstall = $false

    foreach ($item in $Items) {
        Copy-ToRemote -LocalPath $item.Source -RemotePath $item.RemotePath
        $uploaded++

        if ($item.RelativePath -in @("package.json", "package-lock.json")) {
            $needsInstall = $true
        }
    }

    Write-OK "$AppName => $uploaded arquivos enviados"
    return $needsInstall
}

function Restart-RemoteApps {
    param([string[]]$AppNames)

    if (-not $AppNames -or $AppNames.Count -eq 0) {
        return
    }

    Write-Step "Reiniciando PM2"

    foreach ($appName in $AppNames) {
        $app = $REMOTE_APP_INDEX[$appName]
        $pm2Name = $app.Pm2Name
        $pm2Config = if ($app.PSObject.Properties.Name -contains "Pm2Config") { $app.Pm2Config } else { "ecosystem.config.js" }
        $command = "if pm2 describe '$pm2Name' >/dev/null 2>&1; then pm2 restart '$pm2Name' --update-env; else cd '$($app.RemoteRoot)' && pm2 start '$pm2Config'; fi"
        Invoke-Remote -Command $command | Out-Null
        Write-OK "PM2 ativo: $pm2Name"
    }

    Invoke-Remote -Command "pm2 save" | Out-Null
}

function Install-RemoteDependencies {
    param([string[]]$AppNames)

    foreach ($appName in $AppNames) {
        $app = $REMOTE_APP_INDEX[$appName]
        Write-Step "npm install production em $appName"
        Invoke-Remote -Command "cd '$($app.RemoteRoot)' && npm install --omit=dev --no-audit --no-fund" | Out-Null
        Write-OK "$appName => dependencias atualizadas"
    }
}

function Test-RemoteHealth {
    param([string[]]$AppNames)

    $failed = [System.Collections.Generic.List[string]]::new()

    foreach ($appName in $AppNames) {
        $app = $REMOTE_APP_INDEX[$appName]
        $outputFile = "/tmp/$appName-health.json"
        $command = "curl --resolve $REMOTE_DOMAIN`:443:127.0.0.1 -ksS -o '$outputFile' -w '%{http_code}' 'https://$REMOTE_DOMAIN$($app.HealthPath)'"
        $statusCode = (Invoke-Remote -Command $command).Trim()

        if ($statusCode -ne "200") {
            Write-Err "$appName => health check retornou $statusCode"
            $failed.Add($appName) | Out-Null
            continue
        }

        $payload = (Invoke-Remote -Command "head -c 180 '$outputFile'" -IgnoreExitCode).Trim()
        Write-OK "$appName => health 200 $payload"
    }

    return $failed
}

function Restore-RemoteBackups {
    param(
        [Parameter(Mandatory)][string[]]$AppNames,
        [Parameter(Mandatory)][hashtable]$BackupMap
    )

    Write-Step "Restaurando backup remoto"

    foreach ($appName in $AppNames) {
        $app = $REMOTE_APP_INDEX[$appName]
        $backupPath = $BackupMap[$appName]

        if (-not $backupPath) {
            Write-Warn "Sem backup registrado para $appName"
            continue
        }

        Invoke-Remote -Command "test -f '$backupPath' && tar -xzf '$backupPath' -C '$($app.RemoteRoot)'" | Out-Null
        Write-OK "$appName => restaurado"
    }

    Restart-RemoteApps -AppNames $AppNames
}

Set-Location $PROJECT_ROOT

if (-not $SkipBranches) {
    Sync-Branches
}

$deployCandidateFiles = Get-ChangedFiles

if (-not $SkipGit) {
    Invoke-GitStep -DeployFiles $deployCandidateFiles
}

if (-not $SkipVPS) {
    Write-Step "Preparando deploy para VPS"

    if (-not $deployCandidateFiles -or $deployCandidateFiles.Count -eq 0) {
        Write-Warn "Nenhum arquivo elegivel para deploy"
    } else {
        $groupedFiles = Group-DeployFiles -Files $deployCandidateFiles
        $appsToDeploy = @(
            $REMOTE_APPS |
            Where-Object { $groupedFiles[$_.Name].Count -gt 0 } |
            ForEach-Object { $_.Name }
        )

        if (-not $appsToDeploy -or $appsToDeploy.Count -eq 0) {
            Write-Warn "Nenhuma alteracao mapeada para os apps da VPS"
        } else {
            $backupMap = @{}
            if (-not $SkipBackup) {
                $backupMap = Backup-RemoteApps -AppNames $appsToDeploy
            } else {
                Write-Warn "Backup remoto ignorado (-SkipBackup)"
            }
            $appsNeedingInstall = [System.Collections.Generic.List[string]]::new()

            foreach ($appName in $appsToDeploy) {
                $needsInstall = Upload-AppFiles -AppName $appName -Items $groupedFiles[$appName]
                if ($needsInstall) {
                    $appsNeedingInstall.Add($appName) | Out-Null
                }
            }

            if ($appsNeedingInstall.Count -gt 0) {
                Install-RemoteDependencies -AppNames ($appsNeedingInstall.ToArray() | Sort-Object -Unique)
            }

            Restart-RemoteApps -AppNames $appsToDeploy

            Write-Step "Validando health checks"
            $failedApps = Test-RemoteHealth -AppNames $appsToDeploy

            if ($failedApps.Count -gt 0) {
                Restore-RemoteBackups -AppNames @($failedApps) -BackupMap $backupMap
                throw "Deploy revertido para: $($failedApps -join ', ')"
            }

            Write-OK "Deploy validado em: $($appsToDeploy -join ', ')"
        }
    }
}

Write-Host "`n========================================" -ForegroundColor DarkGray
Write-Host " Deploy finalizado" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor DarkGray
