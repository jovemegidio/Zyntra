#!/bin/bash
# Script de teste para verificar status dos módulos ALUFORCE
# Sistema de teste automatizado para verificar funcionalidades

echo "=== TESTE DE INTEGRIDADE SISTEMA ALUFORCE v2.0 ==="
echo "Data: $(date)"
echo ""

# Verificar se servidor está rodando
echo "1. Testando servidor principal..."
$response = Invoke-WebRequest -Uri "http://localhost:3001" -Method GET -TimeoutSec 10 -ErrorAction SilentlyContinue
if ($response.StatusCode -eq 200) {
    Write-Host "✅ Servidor respondendo na porta 3001" -ForegroundColor Green
} else {
    Write-Host "❌ Servidor não está respondendo" -ForegroundColor Red
}

# Testar módulos principais
$modules = @("PCP", "Financeiro", "Compras", "NFe", "RH", "Vendas")

echo "2. Testando módulos..."
foreach ($module in $modules) {
    $url = "http://localhost:3001/modules/$module/"
    try {
        $moduleResponse = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($moduleResponse.StatusCode -eq 200) {
            Write-Host "✅ Módulo $module: OK" -ForegroundColor Green
        } else {
            Write-Host "⚠️ Módulo $module: Status $($moduleResponse.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ Módulo $module: Erro $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Testar API de autenticação
echo "3. Testando API de autenticação..."
try {
    $authResponse = Invoke-WebRequest -Uri "http://localhost:3001/api/user/me" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
    Write-Host "✅ API de autenticação: Respondendo" -ForegroundColor Green
} catch {
    Write-Host "⚠️ API de autenticação: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Verificar recursos estáticos
echo "4. Testando recursos estáticos..."
$staticFiles = @("favicon-aluforce.png", "css/style.css", "js/app.js")

foreach ($file in $staticFiles) {
    $url = "http://localhost:3001/$file"
    try {
        $fileResponse = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($fileResponse.StatusCode -eq 200) {
            Write-Host "✅ Recurso $file: OK" -ForegroundColor Green
        } else {
            Write-Host "⚠️ Recurso $file: Status $($fileResponse.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ Recurso $file: Não encontrado" -ForegroundColor Red
    }
}

echo ""
echo "=== FIM DOS TESTES ==="