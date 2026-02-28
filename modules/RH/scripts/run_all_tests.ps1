# scripts/run_all_tests.ps1
# Orchestrator for local testing: ensures admin user, generates JWT, runs avisos + uploads tests.
# Usage (PowerShell):
#   cd <repo>
#   .\scripts\run_all_tests.ps1

$ErrorActionPreference = 'Stop'
# script is in scripts/; repo root is parent of that
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Repo = Split-Path -Parent $ScriptDir
Set-Location $Repo

Write-Host "Running end-to-end tests (create admin -> gen token -> run tests)"

# 1) Quick server health check
$port = 3000
$hostAddr = '127.0.0.1'
Write-Host ("Checking server on {0}:{1}..." -f $hostAddr, $port) -ForegroundColor Cyan
$nc = Test-NetConnection -ComputerName $hostAddr -Port $port -WarningAction SilentlyContinue
if (-not $nc.TcpTestSucceeded) {
  Write-Host ("Server not responding on {0}:{1}. Attempting to start server (node server.js) in background..." -f $hostAddr, $port) -ForegroundColor Yellow
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { Write-Host "Could not find 'node' in PATH. Start the server manually and rerun this script." -ForegroundColor Red; exit 2 }
  $serverPath = Join-Path $Repo 'server.js'
  if (-not (Test-Path $serverPath)) { Write-Host "server.js not found at $serverPath" -ForegroundColor Red; exit 2 }
  # Quote the server path so Start-Process passes it as a single argument (handles spaces in path)
  $quoted = '"' + $serverPath + '"'
  $startInfo = Start-Process -FilePath $nodeCmd.Source -ArgumentList $quoted -WorkingDirectory $Repo -NoNewWindow -PassThru
  Write-Host ("Started node server, PID={0}. Waiting for it to accept connections..." -f $startInfo.Id) -ForegroundColor Cyan
  $maxWait = 20
  $i = 0
  while ($i -lt $maxWait) {
    Start-Sleep -Seconds 1
    $nc = Test-NetConnection -ComputerName $hostAddr -Port $port -WarningAction SilentlyContinue
    if ($nc.TcpTestSucceeded) { break }
    $i++
  }
  if (-not $nc.TcpTestSucceeded) { Write-Host ("Server did not start within {0} seconds. Check server logs and retry." -f $maxWait) -ForegroundColor Red; exit 3 }
  Write-Host ("Server responded on {0}:{1}" -f $hostAddr, $port) -ForegroundColor Green
} else {
  Write-Host ("Server already responding on {0}:{1}" -f $hostAddr, $port) -ForegroundColor Green
}

# 2) Create or update local admin
Write-Host "Creating/updating local admin (script may require DB env vars)." -ForegroundColor Cyan
& node .\scripts\create_local_admin.js
if ($LASTEXITCODE -ne 0) { Write-Host "create_local_admin failed." -ForegroundColor Red; exit 3 }

# 3) Generate JWT
Write-Host "Generating JWT..." -ForegroundColor Cyan
$tokenOutput = & node .\scripts\generate_jwt.js 2>&1
if ($LASTEXITCODE -ne 0 -or -not $tokenOutput) { Write-Host "generate_jwt failed." -ForegroundColor Red; exit 4 }
$token = $tokenOutput.Trim()
Write-Host ("Token generated (len={0})" -f $token.Length) -ForegroundColor Green

# Export token for child processes
$env:ADMIN_TOKEN = $token

# 4) Run tests and capture outputs
$timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$tmpDir = Join-Path $Repo 'tmp'
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }
$outDir = Join-Path $tmpDir ("test-outputs-$timestamp")
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Write-Host "Running scripts/test_admin_avisos.js..." -ForegroundColor Cyan
& node .\scripts\test_admin_avisos.js *> "$outDir\test_admin_avisos.log"
Write-Host ("Saved -> {0}\test_admin_avisos.log" -f $outDir)

Write-Host "Running scripts/test_uploads.js..." -ForegroundColor Cyan
& node .\scripts\test_uploads.js *> "$outDir\test_uploads.log"
Write-Host ("Saved -> {0}\test_uploads.log" -f $outDir)

Write-Host ("All done. Logs saved in: {0}" -f $outDir) -ForegroundColor Green
Write-Host "If tests failed, paste the contents of the log files here and I'll analyze." -ForegroundColor Yellow
