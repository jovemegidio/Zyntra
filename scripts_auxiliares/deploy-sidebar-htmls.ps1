$base = "g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"
$vps = "root@31.97.64.102"
$vpsBase = "/var/www/aluforce"
$pw = "Aluforce@2026#Vps"
$pscp = "C:\Program Files\PuTTY\pscp.exe"

# All module HTML files that were injected with sidebar-click-animation.js
# Excluding backup folders
$files = @(
    # Vendas
    "modules\Vendas\public\index.html",
    "modules\Vendas\public\pedidos.html",
    "modules\Vendas\public\clientes.html",
    "modules\Vendas\public\estoque.html",
    "modules\Vendas\public\prospeccao.html",
    "modules\Vendas\public\dashboard.html",
    "modules\Vendas\public\dashboard-admin.html",
    "modules\Vendas\public\relatorios.html",
    "modules\Vendas\public\comissoes.html",
    
    # Financeiro
    "modules\Financeiro\index.html",
    "modules\Financeiro\contas-pagar.html",
    "modules\Financeiro\contas-receber.html",
    "modules\Financeiro\fluxo-caixa.html",
    "modules\Financeiro\bancos.html",
    "modules\Financeiro\plano-contas.html",
    "modules\Financeiro\orcamentos.html",
    "modules\Financeiro\conciliacao.html",
    "modules\Financeiro\relatorios.html",
    "modules\Financeiro\centros-custo.html",
    "modules\Financeiro\impostos.html",
    "modules\Financeiro\public\index.html",
    "modules\Financeiro\public\contas_pagar.html",
    "modules\Financeiro\public\contas_receber.html",
    "modules\Financeiro\public\fluxo_caixa.html",
    "modules\Financeiro\public\contas_bancarias.html",
    "modules\Financeiro\public\relatorios.html",
    
    # Compras
    "modules\Compras\index.html",
    "modules\Compras\index-new.html",
    "modules\Compras\pedidos.html",
    "modules\Compras\cotacoes.html",
    "modules\Compras\fornecedores.html",
    "modules\Compras\requisicoes.html",
    "modules\Compras\recebimento.html",
    "modules\Compras\gestao-estoque.html",
    "modules\Compras\relatorios.html",
    "modules\Compras\dashboard-pro.html",
    "modules\Compras\dashboard-executivo.html",
    "modules\Compras\otimizacao-estoque.html",
    "modules\Compras\materias-primas.html",
    "modules\Compras\public\index.html",
    
    # Faturamento
    "modules\Faturamento\public\index.html",
    "modules\Faturamento\public\dashboard.html",
    "modules\Faturamento\public\emitir.html",
    "modules\Faturamento\public\consultar.html",
    "modules\Faturamento\public\danfe.html",
    "modules\Faturamento\public\nfse.html",
    "modules\Faturamento\public\logistica.html",
    "modules\Faturamento\public\eventos.html",
    "modules\Faturamento\public\inutilizacao.html",
    "modules\Faturamento\public\regua.html",
    "modules\Faturamento\public\pix.html",
    "modules\Faturamento\public\relatorios.html",
    
    # NFe
    "modules\NFe\index.html",
    "modules\NFe\emitir.html",
    "modules\NFe\consultar.html",
    "modules\NFe\danfe.html",
    "modules\NFe\nfse.html",
    "modules\NFe\relatorios.html",
    "modules\NFe\eventos.html",
    "modules\NFe\logistica.html",
    "modules\NFe\inutilizacao.html",
    
    # PCP (sub-pages only, index.html already has showView)
    "modules\PCP\index.html",
    "modules\PCP\ordens-producao.html",
    "modules\PCP\apontamentos.html",
    "modules\PCP\relatorios-apontamentos.html",
    "modules\PCP\pages\estoque.html",
    "modules\PCP\pages\materiais.html",
    "modules\PCP\pages\ordem-compra.html",
    "modules\PCP\pages\gestao-producao.html",
    "modules\PCP\pages\faturamento.html",
    "modules\PCP\pages\relatorios.html",
    
    # Admin
    "modules\Admin\public\pages\permissoes.html",
    
    # Consultoria
    "modules\Consultoria\acesso.html"
)

$success = 0
$fail = 0

foreach ($f in $files) {
    $local = Join-Path $base $f
    $remote = "$vpsBase/$($f -replace '\\','/')"
    
    if (Test-Path $local) {
        Write-Host "📤 $f" -NoNewline
        & $pscp -pw $pw -batch $local "${vps}:${remote}" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host " ✅" -ForegroundColor Green
            $success++
        } else {
            Write-Host " ❌" -ForegroundColor Red
            $fail++
        }
    } else {
        Write-Host "⚠️ NOT FOUND: $f" -ForegroundColor Yellow
    }
}

Write-Host "`n📊 Deploy: $success OK, $fail failed"
