# Safe smoke wrapper for this project
# Usage: Open PowerShell in project root and run:
#   powershell -ExecutionPolicy Bypass -File .\scripts\run_smoke_wrapper.ps1

$ErrorActionPreference = 'Stop'

Write-Output "== Smoke wrapper starting =="

# 1) quick checks
try {
    Write-Output "Node: $(node -v)"
    Write-Output "Npm: $(npm -v)"
} catch {
    Write-Error "Node/npm not found in PATH. Install Node.js and ensure node/npm are available."; exit 1
}

$port = 3000

# 2) start server in background (via cmd to run npm start reliably)
Write-Output "Starting server in background (npm start)..."
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm start' -WorkingDirectory (Get-Location) -WindowStyle Hidden

# 3) wait for port to open
$max = 20; $i = 0
while ($i -lt $max) {
    if (Test-NetConnection -ComputerName 'localhost' -Port $port -InformationLevel Quiet) { Write-Output "Port $port OK"; break }
    Start-Sleep -Seconds 1; $i++
}
if ($i -ge $max) { Write-Error "Timeout waiting for port $port. Run 'npm start' in foreground to see errors and paste the logs here."; exit 2 }

# 4) get dev token
$env:NODE_ENV = 'development'
try {
    $tokenResp = Invoke-RestMethod -Uri 'http://localhost:3000/dev/token/1' -ErrorAction Stop
    Write-Output "--- /dev/token response ---"
    $tokenResp | ConvertTo-Json -Depth 5 | Write-Output
} catch {
    Write-Error "Failed to fetch /dev/token/1: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        try { $_.Exception.Response.Content.ReadAsStringAsync().Result | Write-Output } catch {}
    }
    exit 3
}

# 5) validate token
$token = $null
if ($tokenResp -is [System.Collections.Hashtable] -or $tokenResp -is [pscustomobject]) {
    if ($tokenResp.token) { $token = $tokenResp.token }
}
if (-not $token) { Write-Error "Token not present in /dev/token response; paste the response above."; exit 4 }
Write-Output "DEV TOKEN OK (prefix): $($token.Substring(0,40))..."

# 6) prepare and POST pedido with base64 anexos
$filePath = 'scripts\smoke_test_anexo.txt'
if (-not (Test-Path $filePath)) { Write-Error "Attachment file not found: $filePath"; exit 5 }
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$b64 = [System.Convert]::ToBase64String($bytes)
$body = @{ empresa_id = 1; valor = '12.34'; descricao = 'Smoke test upload base64'; anexos = @(@{ name = 'smoke_test_anexo.txt'; type = 'text/plain'; size = $bytes.Length; content = $b64 }) } | ConvertTo-Json -Depth 6

try {
    Write-Output "--- POST /api/vendas/pedidos ---"
    $res = Invoke-RestMethod -Uri 'http://localhost:3000/api/vendas/pedidos' -Method Post -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } -Body $body -ErrorAction Stop
    $res | ConvertTo-Json -Depth 5 | Write-Output
} catch {
    Write-Error "Failed to create pedido: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        try { $_.Exception.Response.Content.ReadAsStringAsync().Result | Write-Output } catch {}
    }
    exit 6
}

$pedidoId = $res.insertedId
if (-not $pedidoId) { Write-Error "Response did not include insertedId. Paste the response above."; exit 7 }
Write-Output "PedidoId: $pedidoId"

# 7) list anexos
try {
    Write-Output "--- GET anexos ---"
    $anexos = Invoke-RestMethod -Uri "http://localhost:3000/api/vendas/pedidos/$pedidoId/anexos" -Headers @{ Authorization = "Bearer $token" } -ErrorAction Stop
    $anexos | ConvertTo-Json -Depth 5 | Write-Output
} catch {
    Write-Error "Failed to list anexos: $($_.Exception.Message)"; exit 8
}

# 8) download first anexo (if any)
if ($anexos -and $anexos.Count -gt 0) {
    $anexoId = $anexos[0].id
    Write-Output "Downloading anexo id=$anexoId..."
    try {
        Invoke-WebRequest -Uri "http://localhost:3000/api/vendas/pedidos/$pedidoId/anexos/$anexoId" -Headers @{ Authorization = "Bearer $token" } -OutFile "downloaded_anexo_$anexoId" -ErrorAction Stop
        Write-Output "Downloaded: downloaded_anexo_$anexoId"
    } catch {
        Write-Error "Failed to download anexo: $($_.Exception.Message)"; exit 9
    }
} else {
    Write-Output "No anexos returned for pedido $pedidoId"
}

Write-Output "== Smoke finished =="
