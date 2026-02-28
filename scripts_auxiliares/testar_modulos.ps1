# Script de Teste - Módulos RH, Compras e Vendas
# Testa autenticação unificada e funcionalidades básicas
# Execute: .\testar_modulos.ps1

Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   TESTE DE INTEGRAÇÃO - SISTEMA ALUFORCE v.2 BETA      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$API_BASE = "http://localhost:3000"
$LOGIN_URL = "$API_BASE/login"
$token = $null
$testsPassed = 0
$testsFailed = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )
    
    Write-Host "`n🔍 Testando: $Name" -ForegroundColor Yellow
    Write-Host "   URL: $Url" -ForegroundColor Gray
    
    try {
        $params = @{
            Uri = $Url
            Method = $Method
            Headers = $Headers
            ContentType = "application/json"
            ErrorAction = "Stop"
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-RestMethod @params
        Write-Host "   ✅ SUCESSO" -ForegroundColor Green
        $script:testsPassed++
        return $response
    }
    catch {
        Write-Host "   ❌ ERRO: $($_.Exception.Message)" -ForegroundColor Red
        $script:testsFailed++
        return $null
    }
}

# ========================================
# 1. TESTE DE LOGIN
# ========================================
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  FASE 1: AUTENTICAÇÃO" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════`n" -ForegroundColor Magenta

$loginData = @{
    email = "admin@aluforce.com"
    senha = "admin123"
}

$loginResponse = Test-Endpoint -Name "Login no Sistema" -Url $LOGIN_URL -Method "POST" -Body $loginData

if ($loginResponse -and $loginResponse.token) {
    $token = $loginResponse.token
    Write-Host "`n   🎫 Token obtido: $($token.Substring(0, 20))..." -ForegroundColor Green
} else {
    Write-Host "`n   ⚠️  Falha no login. Verifique credenciais ou se o servidor está rodando." -ForegroundColor Red
    Write-Host "   Comando para iniciar: node server.js`n" -ForegroundColor Yellow
    exit 1
}

$authHeaders = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# ========================================
# 2. TESTE DE MÓDULO RH
# ========================================
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  FASE 2: MÓDULO RH" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════`n" -ForegroundColor Magenta

# 2.1 Funcionários
$funcionarios = Test-Endpoint `
    -Name "RH - Listar Funcionários" `
    -Url "$API_BASE/api/rh/funcionarios" `
    -Headers $authHeaders

if ($funcionarios) {
    Write-Host "   📊 Total de funcionários: $($funcionarios.Count)" -ForegroundColor Cyan
}

# 2.2 Controle de Ponto
$pontos = Test-Endpoint `
    -Name "RH - Listar Registros de Ponto" `
    -Url "$API_BASE/api/rh/ponto/listar?limite=10" `
    -Headers $authHeaders

if ($pontos) {
    Write-Host "   ⏰ Registros de ponto: $($pontos.Count)" -ForegroundColor Cyan
}

# 2.3 Férias
$ferias = Test-Endpoint `
    -Name "RH - Listar Férias" `
    -Url "$API_BASE/api/rh/ferias/listar?limite=10" `
    -Headers $authHeaders

if ($ferias) {
    Write-Host "   🏖️  Férias cadastradas: $($ferias.Count)" -ForegroundColor Cyan
}

# 2.4 Folha de Pagamento
$folhas = Test-Endpoint `
    -Name "RH - Listar Folhas de Pagamento" `
    -Url "$API_BASE/api/rh/folha/listar" `
    -Headers $authHeaders

if ($folhas) {
    Write-Host "   💰 Folhas geradas: $($folhas.Count)" -ForegroundColor Cyan
}

# 2.5 Benefícios
$beneficios = Test-Endpoint `
    -Name "RH - Dashboard de Benefícios" `
    -Url "$API_BASE/api/rh/beneficios/dashboard" `
    -Headers $authHeaders

if ($beneficios -and $beneficios.resumo) {
    Write-Host "   🎁 Custo mensal de benefícios: R$ $($beneficios.resumo.custo_empresa_mensal)" -ForegroundColor Cyan
}

# 2.6 Avaliações
$avaliacoes = Test-Endpoint `
    -Name "RH - Dashboard de Avaliações" `
    -Url "$API_BASE/api/rh/avaliacoes/dashboard" `
    -Headers $authHeaders

if ($avaliacoes -and $avaliacoes.resumo) {
    Write-Host "   ⭐ Avaliações concluídas: $($avaliacoes.resumo.avaliacoes_concluidas)" -ForegroundColor Cyan
    Write-Host "   📈 Nota média: $($avaliacoes.resumo.nota_media)" -ForegroundColor Cyan
}

# ========================================
# 3. TESTE DE MÓDULO COMPRAS
# ========================================
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  FASE 3: MÓDULO COMPRAS" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════`n" -ForegroundColor Magenta

# 3.1 Fornecedores
$fornecedores = Test-Endpoint `
    -Name "Compras - Listar Fornecedores" `
    -Url "$API_BASE/api/fornecedores" `
    -Headers $authHeaders

if ($fornecedores) {
    Write-Host "   🏢 Total de fornecedores: $($fornecedores.Count)" -ForegroundColor Cyan
}

# 3.2 Pedidos de Compra
$pedidosCompra = Test-Endpoint `
    -Name "Compras - Listar Pedidos de Compra" `
    -Url "$API_BASE/api/pedidos-compra?limit=10" `
    -Headers $authHeaders

if ($pedidosCompra) {
    Write-Host "   📦 Pedidos de compra: $($pedidosCompra.Count)" -ForegroundColor Cyan
}

# 3.3 Dashboard Compras
$dashboardCompras = Test-Endpoint `
    -Name "Compras - Dashboard" `
    -Url "$API_BASE/api/compras/dashboard" `
    -Headers $authHeaders

if ($dashboardCompras) {
    Write-Host "   📊 Dashboard carregado com sucesso" -ForegroundColor Cyan
}

# ========================================
# 4. TESTE DE MÓDULO VENDAS
# ========================================
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  FASE 4: MÓDULO VENDAS" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════`n" -ForegroundColor Magenta

# 4.1 Dashboard Vendas
$dashboardVendas = Test-Endpoint `
    -Name "Vendas - Dashboard Admin" `
    -Url "$API_BASE/api/vendas/dashboard/admin" `
    -Headers $authHeaders

if ($dashboardVendas) {
    Write-Host "   📊 Total de pedidos: $($dashboardVendas.total_pedidos)" -ForegroundColor Cyan
    Write-Host "   ✅ Total de vendas: $($dashboardVendas.total_vendas)" -ForegroundColor Cyan
    Write-Host "   💰 Faturamento: R$ $($dashboardVendas.faturamento_total)" -ForegroundColor Cyan
}

# 4.2 Pedidos de Vendas
$pedidosVendas = Test-Endpoint `
    -Name "Vendas - Listar Pedidos" `
    -Url "$API_BASE/api/vendas/pedidos?limite=10" `
    -Headers $authHeaders

if ($pedidosVendas) {
    Write-Host "   📋 Pedidos de vendas: $($pedidosVendas.Count)" -ForegroundColor Cyan
}

# 4.3 Clientes
$clientes = Test-Endpoint `
    -Name "Vendas - Listar Clientes" `
    -Url "$API_BASE/api/vendas/clientes" `
    -Headers $authHeaders

if ($clientes) {
    Write-Host "   👥 Total de clientes: $($clientes.Count)" -ForegroundColor Cyan
}

# 4.4 Empresas
$empresas = Test-Endpoint `
    -Name "Vendas - Listar Empresas" `
    -Url "$API_BASE/api/vendas/empresas" `
    -Headers $authHeaders

if ($empresas) {
    Write-Host "   🏭 Total de empresas: $($empresas.Count)" -ForegroundColor Cyan
}

# ========================================
# 5. TESTE DE PERMISSÕES
# ========================================
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  FASE 5: TESTE DE PERMISSÕES" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════`n" -ForegroundColor Magenta

# 5.1 Verificar informações do usuário
$userInfo = Test-Endpoint `
    -Name "Informações do Usuário Logado" `
    -Url "$API_BASE/api/user/me" `
    -Headers $authHeaders

if ($userInfo) {
    Write-Host "   👤 Usuário: $($userInfo.nome)" -ForegroundColor Cyan
    Write-Host "   📧 Email: $($userInfo.email)" -ForegroundColor Cyan
    Write-Host "   🎭 Role: $($userInfo.role)" -ForegroundColor Cyan
}

# 5.2 Teste de rota protegida sem token
Write-Host "`n🔐 Testando acesso sem autenticação (deve falhar)..." -ForegroundColor Yellow
try {
    $noAuthTest = Invoke-RestMethod -Uri "$API_BASE/api/rh/funcionarios" -Method GET -ErrorAction Stop
    Write-Host "   ❌ FALHA DE SEGURANÇA: Rota acessível sem token!" -ForegroundColor Red
    $script:testsFailed++
} catch {
    Write-Host "   ✅ SUCESSO: Rota protegida corretamente (401 Unauthorized)" -ForegroundColor Green
    $script:testsPassed++
}

# ========================================
# 6. RELATÓRIO FINAL
# ========================================
Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              RELATÓRIO DE TESTES                        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$totalTests = $testsPassed + $testsFailed
$successRate = if ($totalTests -gt 0) { [math]::Round(($testsPassed / $totalTests) * 100, 2) } else { 0 }

Write-Host "   📊 Total de testes: $totalTests" -ForegroundColor White
Write-Host "   ✅ Testes aprovados: $testsPassed" -ForegroundColor Green
Write-Host "   ❌ Testes falhados: $testsFailed" -ForegroundColor Red
Write-Host "   📈 Taxa de sucesso: $successRate%`n" -ForegroundColor $(if ($successRate -ge 80) { "Green" } elseif ($successRate -ge 50) { "Yellow" } else { "Red" })

if ($successRate -eq 100) {
    Write-Host "   🎉 PARABÉNS! Todos os testes passaram!`n" -ForegroundColor Green
} elseif ($successRate -ge 80) {
    Write-Host "   ✅ Boa! Sistema funcional com alguns ajustes necessários.`n" -ForegroundColor Yellow
} else {
    Write-Host "   ⚠️  Atenção! Vários testes falharam. Verifique a configuração.`n" -ForegroundColor Red
}

# ========================================
# 7. CHECKLIST DE VERIFICAÇÃO MANUAL
# ========================================
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║        CHECKLIST DE VERIFICAÇÃO MANUAL                  ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════════╝`n" -ForegroundColor Magenta

Write-Host "   [ ] 1. Acesse http://localhost:3000/public/login.html" -ForegroundColor Cyan
Write-Host "   [ ] 2. Faça login com credenciais válidas" -ForegroundColor Cyan
Write-Host "   [ ] 3. Acesse http://localhost:3000/modules/RH/rh.html" -ForegroundColor Cyan
Write-Host "   [ ] 4. Verifique se todas as 7 abas do RH carregam" -ForegroundColor Cyan
Write-Host "   [ ] 5. Acesse http://localhost:3000/modules/Compras/" -ForegroundColor Cyan
Write-Host "   [ ] 6. Verifique funcionalidades de compras" -ForegroundColor Cyan
Write-Host "   [ ] 7. Acesse http://localhost:3000/modules/Vendas/public/" -ForegroundColor Cyan
Write-Host "   [ ] 8. Verifique se Vendas NÃO pede login novamente" -ForegroundColor Cyan
Write-Host "   [ ] 9. Teste navegação entre módulos via sidebar" -ForegroundColor Cyan
Write-Host "   [ ] 10. Teste logout e verifique redirecionamento`n" -ForegroundColor Cyan

Write-Host "═══════════════════════════════════════════════════════════`n" -ForegroundColor Cyan
Write-Host "Teste concluído em $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')" -ForegroundColor Gray
Write-Host "`n"
