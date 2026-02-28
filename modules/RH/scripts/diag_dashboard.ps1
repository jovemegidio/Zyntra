# scripts/diag_dashboard.ps1
# Diagnostic helper for quick local checks against the running server.
# Usage:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\diag_dashboard.ps1

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $Repo

function Write-Info($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host $m -ForegroundColor Green }
function Write-Err($m) { Write-Host $m -ForegroundColor Red }

$base = 'http://127.0.0.1:3000'
$loginUri = "$base/api/login"
$summaryUri = "$base/api/dashboard/summary"
$debugTokenUri = "$base/api/debug/generate-token"

Write-Info "Running diagnostic against $base"

# Attempt to use ADMIN_TOKEN env first if available
$envToken = $env:ADMIN_TOKEN
if ($null -ne $envToken) { $envToken = $envToken.Trim() }
if ($envToken) { Write-Info "Found ADMIN_TOKEN in environment (length=$($envToken.Length)). Will use it." }

# Helper to safely call an endpoint and return object with status/body/ok
function Invoke-JsonSafe {
    param(
        [string]$Method = 'GET',
        [string]$Uri,
        $Body = $null,
        $Headers = $null,
        [int]$TimeoutSec = 10
    )
    try {
        if ($Body -ne $null) {
            $resp = Invoke-RestMethod -Uri $Uri -Method $Method -Body ($Body | ConvertTo-Json -Depth 5) -ContentType 'application/json' -Headers $Headers -TimeoutSec $TimeoutSec -ErrorAction Stop
            return @{ ok = $true; status = 200; body = $resp }
        } else {
            $resp = Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -TimeoutSec $TimeoutSec -ErrorAction Stop
            # If resp is string/json it will be parsed to object; for raw responses use Invoke-WebRequest instead.
            return @{ ok = $true; status = 200; body = $resp }
        }
    } catch {
        # Try to extract HTTP status and body from the WebException if present
        $ex = $_.Exception
        $result = @{ ok = $false; status = $null; body = $null; error = $_.Exception.Message }
        if ($ex -and $ex.Response) {
            try {
                $ws = [System.Net.HttpWebResponse]$ex.Response
                $result.status = $ws.StatusCode.value__
                try {
                    $sr = New-Object System.IO.StreamReader($ws.GetResponseStream())
                    $text = $sr.ReadToEnd()
                    # attempt to parse JSON body if possible
                    try { $json = $text | ConvertFrom-Json -ErrorAction SilentlyContinue; if ($json) { $result.body = $json } else { $result.body = $text } } catch { $result.body = $text }
                } catch { $result.body = $null }
            } catch { }
        }
        return $result
    }
}

# 1) Try to login using known admin credentials (local default)
$loginPayload = @{ email = 'rh@aluforce.ind.br'; senha = 'admin123' }
$token = $null

if (-not $envToken) {
    Write-Info "Attempting login to $loginUri"
    $loginResult = Invoke-JsonSafe -Method 'POST' -Uri $loginUri -Body $loginPayload -TimeoutSec 8
    if ($loginResult.ok -and $loginResult.body -and $loginResult.body.token) {
        $token = $loginResult.body.token.ToString()
        Write-Ok "Login succeeded. Token length=$($token.Length)"
    } else {
        Write-Err "Login failed: $($loginResult.error)"
        if ($loginResult.status) { Write-Err "HTTP Status: $($loginResult.status)" }
        if ($loginResult.body) { Write-Host "Body:"; Write-Host ($loginResult.body | ConvertTo-Json -Depth 5) }
        # Try debug token endpoint as fallback (only available in non-production)
        Write-Info "Attempting debug token endpoint as fallback: $debugTokenUri"
        $debugResult = Invoke-JsonSafe -Method 'POST' -Uri $debugTokenUri -Body @{ id = 8; role = 'admin' } -TimeoutSec 6
        if ($debugResult.ok -and $debugResult.body -and $debugResult.body.token) {
            $token = $debugResult.body.token.ToString()
            Write-Ok "Received debug token (len=$($token.Length))."
        } else {
            Write-Err "Debug token endpoint failed or not available. Can't obtain token automatically."
            if ($debugResult.status) { Write-Err "Debug endpoint status: $($debugResult.status)" }
        }
    }
} else {
    $token = $envToken
}

if (-not $token) {
    Write-Err "No token available. Set ADMIN_TOKEN env or start server with debug token endpoint enabled. Exiting."
    exit 20
}

# 2) Call dashboard summary with token
$headers = @{ Authorization = "Bearer $token" }
Write-Info "Requesting $summaryUri with Authorization Bearer token..."
$summaryRes = Invoke-JsonSafe -Method 'GET' -Uri $summaryUri -Headers $headers -TimeoutSec 8
if ($summaryRes.ok) {
    Write-Ok "SUMMARY OK"
    try {
        $bodyJson = $summaryRes.body
        Write-Host ($bodyJson | ConvertTo-Json -Depth 6)
    } catch {
        Write-Host $summaryRes.body
    }
    exit 0
} else {
    Write-Err "Failed to fetch dashboard summary."
    if ($summaryRes.status) { Write-Err "HTTP Status: $($summaryRes.status)" }
    if ($summaryRes.body) { Write-Host "Body:"; Write-Host ($summaryRes.body | ConvertTo-Json -Depth 6) }
    Write-Err "Error: $($summaryRes.error)"
    exit 21
}

