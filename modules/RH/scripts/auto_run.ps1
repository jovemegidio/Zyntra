# Script de automação para instalar dependências, rodar lint, iniciar servidor e executar smoke test
# Como usar:
# - No PowerShell: powershell -ExecutionPolicy Bypass -File "C:\caminho\para\repo\scripts\auto_run.ps1"
# - No VSCode: arraste o arquivo para o terminal para preencher o caminho absoluto e pressione Enter

try {
    # Diretório onde o script está localizado
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    Write-Host "[auto_run] Diretório do script: $scriptDir"

    # Subir diretórios até encontrar package.json (raiz do repositório)
    $root = $scriptDir
    while (-not (Test-Path -Path (Join-Path $root 'package.json'))) {
        $parent = Split-Path -Parent $root
        if ($parent -eq $root -or [string]::IsNullOrEmpty($parent)) {
            break
        }
        $root = $parent
    }

    if (-not (Test-Path -Path (Join-Path $root 'package.json'))) {
        Write-Error "[auto_run] package.json não encontrado em nenhum diretório acima de $scriptDir. Execute o script dentro do repositório."
        exit 2
    }

    Set-Location -Path $root
    Write-Host "[auto_run] Localizado raiz do repositório: $root"
} catch {
    Write-Error "[auto_run] Falha ao determinar a localização do script: $_"
    exit 1
}

# Instalar dependências
Write-Host "[auto_run] Instalando dependências (npm ci)..."
$rc = & npm ci 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "[auto_run] npm ci falhou. Saída:"
    Write-Host $rc
    exit $LASTEXITCODE
}
Write-Host "[auto_run] Dependências instaladas."

# Rodar lint (se existir)
if ((Get-Command npm -ErrorAction SilentlyContinue) -and (Get-Content package.json | Select-String '"lint"')) {
    Write-Host "[auto_run] Rodando lint..."
    $lintOut = & npm run lint 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "[auto_run] lint retornou erros (seguir diagnóstico):"
        Write-Host $lintOut
        # não parar aqui — ainda tentaremos iniciar servidor e executar smoke tests
    } else {
        Write-Host "[auto_run] lint OK."
    }
} else {
    Write-Host "[auto_run] script de lint não encontrado em package.json — pulando lint."
}

# Iniciar servidor com npm start em background (PM2/restart não usado aqui)
Write-Host "[auto_run] Iniciando servidor com 'npm start' em uma nova janela de terminal..."
# Start-Process abre nova janela; preferir Start-Process para não bloquear o script
Start-Process -FilePath npm -ArgumentList 'start' -WorkingDirectory $root

# Aguardar para o servidor subir (algumas apps demoram mais que 3s)
Write-Host "[auto_run] Aguardando 8 segundos para o servidor inicializar..."
Start-Sleep -Seconds 8

# Executar smoke test se existir o script
$smokeScript = Join-Path $root 'scripts\test_login_request.js'
if (Test-Path $smokeScript) {
    Write-Host "[auto_run] Executando smoke test: $smokeScript"
    & node $smokeScript
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "[auto_run] Smoke test falhou. Código de saída: $LASTEXITCODE"
    } else {
        Write-Host "[auto_run] Smoke test finalizado com sucesso."
    }
} else {
    Write-Host "[auto_run] Smoke test $smokeScript não encontrado — terminando." 
}

Write-Host "[auto_run] Concluído."
