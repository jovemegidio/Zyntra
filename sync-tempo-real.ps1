# ============================================
# ALUFORCE - Sincronização em Tempo Real
# ============================================
# Monitora alterações e envia para o servidor automaticamente
# USA PUTTY (PSCP/PLINK) - SEM PEDIR SENHA
# Caminho atualizado para Google Drive

$servidor = "31.97.64.102"
$usuario = "root"
$senha = "Aluforce@2026#Vps"
$caminhoRemoto = "/var/www/aluforce"
$caminhoLocal = "G:\.shortcut-targets-by-id\1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN\Sistema - ALUFORCE - V.2"

# Adicionar PuTTY ao PATH se necessário
if (-not (Get-Command pscp -ErrorAction SilentlyContinue)) {
   $env:Path += ";C:\Program Files\PuTTY"
}

# Pastas a monitorar
$pastasMonitorar = @(
   "modules",
   "public",
   "js",
   "routes",
   "api",
   "config",
   "middleware",
   "server",
   "templates",
   "src",
   "utils"
)

# Arquivos na raiz a monitorar
$arquivosRaiz = @(
   "server.js",
   "index.html",
   "security-middleware.js",
   "ecosystem.config.js",
   "package.json"
)

# Arquivos que requerem restart do servidor
$arquivosRestart = @(
   "server.js",
   "security-middleware.js",
   "ecosystem.config.js"
)

# Pastas que requerem restart
$pastasRestart = @("routes", "api", "server", "middleware", "config")

Clear-Host
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   ALUFORCE - Sincronizacao em Tempo Real  " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Servidor: $servidor" -ForegroundColor Yellow
Write-Host "Caminho:  $caminhoRemoto" -ForegroundColor Yellow
Write-Host "Local:    $caminhoLocal" -ForegroundColor Yellow
Write-Host ""
Write-Host "Monitorando alteracoes em:" -ForegroundColor Green
$pastasMonitorar | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
Write-Host ""
Write-Host "Pressione Ctrl+C para parar" -ForegroundColor Magenta
Write-Host ""
Write-Host "--------------------------------------------" -ForegroundColor DarkGray

# Função para enviar arquivo (USANDO PSCP - SEM SENHA)
function Enviar-Arquivo {
   param (
      [string]$arquivoLocal,
      [string]$arquivoRelativo
   )

   $timestamp = Get-Date -Format "HH:mm:ss"

   # Criar diretório remoto se necessário
   $dirRemoto = Split-Path $arquivoRelativo -Parent
   if ($dirRemoto) {
      $dirRemoto = $dirRemoto -replace '\\', '/'
      plink -batch -pw $senha $usuario@$servidor "mkdir -p $caminhoRemoto/$dirRemoto" 2>$null
   }

   Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
   Write-Host "Enviando: " -NoNewline -ForegroundColor Yellow
   Write-Host "$arquivoRelativo" -ForegroundColor White

   # Converter caminho para formato Unix
   $arquivoRelativoUnix = $arquivoRelativo -replace '\\', '/'

   # USAR PSCP COM SENHA AUTOMÁTICA
   $result = pscp -batch -pw $senha -q "$arquivoLocal" "${usuario}@${servidor}:$caminhoRemoto/$arquivoRelativoUnix" 2>&1

   if ($LASTEXITCODE -eq 0) {
      Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
      Write-Host "OK " -NoNewline -ForegroundColor Green
      Write-Host "- Arquivo sincronizado!" -ForegroundColor Gray

      # Verificar se precisa reiniciar
      $nomeArquivo = Split-Path $arquivoLocal -Leaf
      $extensao = [System.IO.Path]::GetExtension($arquivoLocal)

      # Verificar pasta do arquivo
      $pastaArquivo = $arquivoRelativo.Split('\')[0]

      $precisaRestart = $false

      # Reiniciar se for arquivo JS em pastas críticas
      if ($pastaArquivo -in $pastasRestart -and $extensao -eq ".js") {
         $precisaRestart = $true
      }

      # Reiniciar se for arquivo crítico na raiz
      if ($nomeArquivo -in $arquivosRestart) {
         $precisaRestart = $true
      }

      if ($precisaRestart) {
         Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
         Write-Host "Reiniciando servidor..." -ForegroundColor Cyan
         plink -batch -pw $senha $usuario@$servidor "cd $caminhoRemoto && pm2 restart aluforce-dashboard --update-env" 2>$null
         Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
         Write-Host "Servidor reiniciado!" -ForegroundColor Green
      }
   }
   else {
      Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
      Write-Host "ERRO " -NoNewline -ForegroundColor Red
      Write-Host "- Falha ao enviar arquivo: $result" -ForegroundColor Red
   }

   Write-Host ""
}

# Função para processar eventos
function Process-FileEvent {
   param($path, $changeType)

   # Ignorar arquivos temporários e git
   if ($path -match '\.tmp$|\.swp$|~$|\.git|\.vs|node_modules') { return }

   # Calcular caminho relativo
   $relativo = $path.Replace("$caminhoLocal\", "")

   if ($changeType -eq "Changed" -or $changeType -eq "Created") {
      # Aguardar arquivo ser salvo completamente
      Start-Sleep -Milliseconds 800

      # Verificar se arquivo existe e não está bloqueado
      if (Test-Path $path) {
         try {
            Enviar-Arquivo -arquivoLocal $path -arquivoRelativo $relativo
         }
         catch {
            $timestamp = Get-Date -Format "HH:mm:ss"
            Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
            Write-Host "ERRO: " -NoNewline -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
         }
      }
   }
}

# Criar FileSystemWatcher para cada pasta
$watchers = @()
$jobs = @()

foreach ($pasta in $pastasMonitorar) {
   $caminhoCompleto = Join-Path $caminhoLocal $pasta

   if (Test-Path $caminhoCompleto) {
      $watcher = New-Object System.IO.FileSystemWatcher
      $watcher.Path = $caminhoCompleto
      $watcher.Filter = "*.*"
      $watcher.IncludeSubdirectories = $true
      $watcher.EnableRaisingEvents = $true
      $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName

      # Evento de alteração
      $action = {
         $path = $Event.SourceEventArgs.FullPath
         $changeType = $Event.SourceEventArgs.ChangeType
         $caminhoLocal = "G:\.shortcut-targets-by-id\1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN\Sistema - ALUFORCE - V.2"
         $servidor = "31.97.64.102"
         $usuario = "root"
         $senha = "Aluforce@2026#Vps"
         $caminhoRemoto = "/var/www/aluforce"

         # Ignorar arquivos temporários
         if ($path -match '\.tmp$|\.swp$|~$|\.git|\.vs|node_modules') { return }

         # Calcular caminho relativo
         $relativo = $path.Replace("$caminhoLocal\", "")

         if ($changeType -eq "Changed" -or $changeType -eq "Created") {
            Start-Sleep -Milliseconds 800

            if (Test-Path $path) {
               $timestamp = Get-Date -Format "HH:mm:ss"

               # Criar diretório remoto se necessário
               $dirRemoto = Split-Path $relativo -Parent
               if ($dirRemoto) {
                  $dirRemoto = $dirRemoto -replace '\\', '/'
                  plink -batch -pw $senha $usuario@$servidor "mkdir -p $caminhoRemoto/$dirRemoto" 2>$null
               }

               Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
               Write-Host "Enviando: " -NoNewline -ForegroundColor Yellow
               Write-Host "$relativo" -ForegroundColor White

               # Converter caminho para formato Unix
               $relativoUnix = $relativo -replace '\\', '/'

               # USAR PSCP COM SENHA AUTOMÁTICA
               pscp -batch -pw $senha -q "$path" "${usuario}@${servidor}:$caminhoRemoto/$relativoUnix" 2>$null

               if ($LASTEXITCODE -eq 0) {
                  Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
                  Write-Host "OK " -NoNewline -ForegroundColor Green
                  Write-Host "- Sincronizado!" -ForegroundColor Gray

                  # Verificar se precisa restart
                  $nomeArquivo = Split-Path $path -Leaf
                  $extensao = [System.IO.Path]::GetExtension($path)
                  $pastaArquivo = $relativo.Split('\')[0]
                  $pastasRestart = @("routes", "api", "server", "middleware", "config")
                  $arquivosRestart = @("server.js", "security-middleware.js", "ecosystem.config.js")

                  if (($pastaArquivo -in $pastasRestart -and $extensao -eq ".js") -or ($nomeArquivo -in $arquivosRestart)) {
                     Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
                     Write-Host "Reiniciando PM2..." -ForegroundColor Cyan
                     plink -batch -pw $senha $usuario@$servidor "pm2 restart aluforce-dashboard --update-env" 2>$null
                     Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
                     Write-Host "PM2 reiniciado!" -ForegroundColor Green
                  }
               }
               else {
                  Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
                  Write-Host "ERRO ao enviar" -ForegroundColor Red
               }
               Write-Host ""
            }
         }
      }

      Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
      Register-ObjectEvent $watcher "Created" -Action $action | Out-Null

      $watchers += $watcher
      Write-Host "  Monitorando: $pasta" -ForegroundColor DarkCyan
   }
}

# Monitorar arquivos na raiz
$watcherRaiz = New-Object System.IO.FileSystemWatcher
$watcherRaiz.Path = $caminhoLocal
$watcherRaiz.Filter = "*.*"
$watcherRaiz.IncludeSubdirectories = $false
$watcherRaiz.EnableRaisingEvents = $true

$actionRaiz = {
   $path = $Event.SourceEventArgs.FullPath
   $changeType = $Event.SourceEventArgs.ChangeType
   $nome = Split-Path $path -Leaf
   $servidor = "31.97.64.102"
   $usuario = "root"
   $senha = "Aluforce@2026#Vps"
   $caminhoRemoto = "/var/www/aluforce"

   $arquivosMonitorar = @("server.js", "index.html", "security-middleware.js", "ecosystem.config.js", "package.json")

   if ($nome -in $arquivosMonitorar) {
      if ($changeType -eq "Changed" -or $changeType -eq "Created") {
         Start-Sleep -Milliseconds 800

         $timestamp = Get-Date -Format "HH:mm:ss"
         Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
         Write-Host "Enviando: " -NoNewline -ForegroundColor Yellow
         Write-Host "$nome" -ForegroundColor White

         pscp -batch -pw $senha -q "$path" "${usuario}@${servidor}:$caminhoRemoto/$nome" 2>$null

         if ($LASTEXITCODE -eq 0) {
            Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
            Write-Host "OK " -NoNewline -ForegroundColor Green
            Write-Host "- Sincronizado!" -ForegroundColor Gray

            if ($nome -in @("server.js", "security-middleware.js", "ecosystem.config.js")) {
               Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
               Write-Host "Reiniciando PM2..." -ForegroundColor Cyan
               plink -batch -pw $senha $usuario@$servidor "pm2 restart aluforce-dashboard --update-env" 2>$null
               Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
               Write-Host "PM2 reiniciado!" -ForegroundColor Green
            }
         }
         Write-Host ""
      }
   }
}

Register-ObjectEvent $watcherRaiz "Changed" -Action $actionRaiz | Out-Null

Write-Host ""
Write-Host "--------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Sincronizacao ATIVA! Aguardando alteracoes..." -ForegroundColor Green
Write-Host ""

# Manter script rodando
try {
   while ($true) {
      Start-Sleep -Seconds 1
   }
}
finally {
   # Limpar watchers ao sair
   Get-EventSubscriber | Unregister-Event
   $watchers | ForEach-Object { $_.Dispose() }
   $watcherRaiz.Dispose()
   Write-Host ""
   Write-Host "Sincronizacao encerrada." -ForegroundColor Yellow
}
