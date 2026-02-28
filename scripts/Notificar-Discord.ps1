# ============================================
# ALUFORCE - Helper de Notificacao Discord
# ============================================
# Funcao reutilizavel para enviar notificacoes ao Discord
# Compativel com PowerShell 5.1+
#
# USO:
#   . .\scripts\Notificar-Discord.ps1
#   Notificar-Discord -Titulo "Deploy Financeiro" -Arquivos @("file1.js") -Modulo "Financeiro"
#   Notificar-Discord -Titulo "Hotfix Vendas" -Tipo "fix" -Descricao "Corrigido bug" -Modulo "Vendas"
# ============================================

$global:DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1465740298243018793/fjkXYSN7Vv06YRyimpqneNVOhADqDACpVTXQxRbyUJnsk-cWpJvnpZzD9JntRVFyhfVt"

# Emojis via surrogate pairs (compativel PS 5.1)
function _Emoji([int]$code) {
    if ($code -le 0xFFFF) { return [string][char]$code }
    return [char]::ConvertFromUtf32($code)
}

function Notificar-Discord {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Titulo,
        [string]$Descricao = "",
        [string]$Tipo = "deploy",
        [string]$Modulo = "Sistema",
        [string[]]$Arquivos = @(),
        [string[]]$Alteracoes = @(),
        [int]$Enviados = 0,
        [int]$Erros = 0,
        [string]$Autor = $env:USERNAME
    )

    # Emojis e cores por tipo
    $rocket    = _Emoji 0x1F680
    $sparkles  = _Emoji 0x2728
    $bug       = _Emoji 0x1F41B
    $zap       = _Emoji 0x26A1
    $ambulance = _Emoji 0x1F691
    $lock      = _Emoji 0x1F512
    $art       = _Emoji 0x1F3A8
    $recycle   = _Emoji 0x267B
    $gear      = _Emoji 0x2699

    switch ($Tipo) {
        "deploy"      { $emoji = $rocket;    $color = 3066993;  $label = "Deploy" }
        "feature"     { $emoji = $sparkles;  $color = 3066993;  $label = "Nova Funcionalidade" }
        "fix"         { $emoji = $bug;       $color = 15158332; $label = "Correcao de Bug" }
        "improvement" { $emoji = $zap;       $color = 15844367; $label = "Melhoria" }
        "hotfix"      { $emoji = $ambulance; $color = 16711680; $label = "Hotfix Urgente" }
        "security"    { $emoji = $lock;      $color = 15277667; $label = "Seguranca" }
        "style"       { $emoji = $art;       $color = 3447003;  $label = "Interface/Estilo" }
        "refactor"    { $emoji = $recycle;   $color = 10181046; $label = "Refatoracao" }
        "config"      { $emoji = $gear;      $color = 6323595;  $label = "Configuracao" }
        default       { $emoji = $rocket;    $color = 3066993;  $label = "Deploy" }
    }

    # Montar campos
    $fields = [System.Collections.ArrayList]@()
    [void]$fields.Add(@{ name = "Tipo"; value = $label; inline = $true })
    [void]$fields.Add(@{ name = "Modulo"; value = $Modulo; inline = $true })
    [void]$fields.Add(@{ name = "Autor"; value = $Autor; inline = $true })

    if ($Enviados -gt 0) {
        [void]$fields.Add(@{ name = "Arquivos Enviados"; value = "$Enviados arquivo(s)"; inline = $true })
    }
    if ($Erros -gt 0) {
        [void]$fields.Add(@{ name = "Erros"; value = "$Erros"; inline = $true })
    }

    if ($Arquivos.Count -gt 0) {
        $listaArquivos = ($Arquivos | Select-Object -First 15 | ForEach-Object { "``$_``" }) -join "`n"
        if ($Arquivos.Count -gt 15) {
            $listaArquivos += "`n... +$($Arquivos.Count - 15) arquivo(s)"
        }
        $maxLen = [Math]::Min($listaArquivos.Length, 1024)
        [void]$fields.Add(@{ name = "Arquivos ($($Arquivos.Count))"; value = $listaArquivos.Substring(0, $maxLen); inline = $false })
    }

    if ($Alteracoes.Count -gt 0) {
        $listaAlteracoes = ($Alteracoes | Select-Object -First 20 | ForEach-Object { "- $_" }) -join "`n"
        $maxLen = [Math]::Min($listaAlteracoes.Length, 1024)
        [void]$fields.Add(@{ name = "Alteracoes ($($Alteracoes.Count))"; value = $listaAlteracoes.Substring(0, $maxLen); inline = $false })
    }

    [void]$fields.Add(@{ name = "Horario"; value = (Get-Date -Format "dd/MM/yyyy HH:mm:ss"); inline = $true })

    # Versao do package.json
    $versao = "2.0.0"
    try {
        $pkgPath = Join-Path $PSScriptRoot "..\package.json"
        if (Test-Path $pkgPath) {
            $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($pkg.version) { $versao = $pkg.version }
        }
    } catch {}

    # Descricao
    $descFinal = if ($Descricao) { $Descricao } else { "Deploy realizado com sucesso no servidor." }

    # Payload
    $payload = @{
        embeds = @(
            @{
                title       = "$emoji $Titulo"
                description = $descFinal
                color       = $color
                fields      = @($fields.ToArray())
                footer      = @{ text = "ALUFORCE v$versao | Deploy via PowerShell" }
                timestamp   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            }
        )
    } | ConvertTo-Json -Depth 10

    # Enviar
    try {
        Write-Host ""
        Write-Host ">>> Notificando Discord..." -ForegroundColor Magenta
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        Invoke-RestMethod -Uri $global:DISCORD_WEBHOOK -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes | Out-Null
        Write-Host "[OK] Discord notificado!" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[AVISO] Falha ao notificar Discord: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

Write-Host "[Discord] Helper de notificacao carregado" -ForegroundColor DarkGray
