$ErrorActionPreference = 'Stop'

$loginBody = @{ email = 'rh@aluforce.ind.br'; senha = 'admin123' } | ConvertTo-Json
try {
    Write-Host "Fazendo login..."
    $login = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/login' -Method Post -Body $loginBody -ContentType 'application/json' -TimeoutSec 10
    Write-Host "Login OK - user id: $($login.userData.id)"
    $token = $login.token
    $headers = @{ Authorization = "Bearer $token" }

    Write-Host "\nChamando GET /api/funcionarios..."
    try {
        $users = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/funcionarios' -Headers $headers -TimeoutSec 10
        Write-Host "FUNCIONARIOS_OK - Count: $($users.Count)"
        $users | ConvertTo-Json -Depth 5
    } catch {
        Write-Host "FUNCIONARIOS_ERR: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $sr = $_.Exception.Response.GetResponseStream()
            $rdr = New-Object System.IO.StreamReader($sr)
            Write-Host "FUNCIONARIOS_BODY:"; Write-Host ($rdr.ReadToEnd())
        }
    }

    Write-Host "\nChamando GET /api/dashboard/summary..."
    try {
        $summary = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/dashboard/summary' -Headers $headers -TimeoutSec 10
        Write-Host "DASHBOARD_OK"
        $summary | ConvertTo-Json -Depth 5
    } catch {
        Write-Host "DASHBOARD_ERR: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $sr = $_.Exception.Response.GetResponseStream()
            $rdr = New-Object System.IO.StreamReader($sr)
            Write-Host "DASHBOARD_BODY:"; Write-Host ($rdr.ReadToEnd())
        }
    }

} catch {
    Write-Host "LOGIN_FAIL: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $sr = $_.Exception.Response.GetResponseStream()
        $rdr = New-Object System.IO.StreamReader($sr)
        Write-Host "LOGIN_BODY:"; Write-Host ($rdr.ReadToEnd())
    }
}

