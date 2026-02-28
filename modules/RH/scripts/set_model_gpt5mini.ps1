<#
scripts/set_model_gpt5mini.ps1
Search and replace common model settings to 'gpt-5-mini' across workspace files.
Creates a .bak backup for each modified file. Intended for local/dev use only.

Usage:
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\set_model_gpt5mini.ps1
#>

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

Write-Host "Searching for files to update model -> gpt-5-mini"
$patterns = @('*.env','*.json','*.js','*.ts','*.yml','*.yaml')
$files = Get-ChildItem -Path $root -Recurse -Include $patterns -File -ErrorAction SilentlyContinue
if (-not $files -or $files.Count -eq 0) {
  Write-Host "No target files found."; exit 0
}

foreach ($f in $files) {
  try {
    $text = Get-Content -Raw -LiteralPath $f.FullName -ErrorAction Stop
    $orig = $text

    # backup
    $bak = $f.FullName + '.bak'
    if (-not (Test-Path $bak)) { Copy-Item -LiteralPath $f.FullName -Destination $bak -Force }

    # 1) replace env-style: MODEL=...
    $text = [regex]::Replace($text, '(?m)^(MODEL\s*=\s*).+$', '${1}gpt-5-mini')

    # 2) replace JSON: "model": "..."  (allow optional spaces)
    $text = [regex]::Replace($text, '"model"\s*:\s*"[^"]+"', '"model":"gpt-5-mini"')

    # 3) replace common JS/TS/YAML style: model: 'gpt-4' or model = "gpt-4"
    $pattern = "model\\s*[:=]\\s*[\"']gpt-[^\"']+[\"']"
    $text = [regex]::Replace($text, $pattern, 'model: "gpt-5-mini"')

    if ($text -ne $orig) {
      Set-Content -LiteralPath $f.FullName -Value $text -Encoding UTF8
      Write-Host "Updated: $($f.FullName)"
    }
  } catch {
    Write-Warning "Failed to process $($f.FullName): $_"
  }
}

Write-Host "Done. Backups saved as *.bak where changes were made." -ForegroundColor Green
