# Deploy Sidebar Animation to VPS
# Uploads CSS, JS, and all modified HTML files

$VPS = "root@31.97.64.102"
$PASS = "Aluforce@2026#Vps"
$REMOTE = "/var/www/aluforce"
$LOCAL = "g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"
$PSCP = "C:\Program Files\PuTTY\pscp.exe"
$PLINK = "C:\Program Files\PuTTY\plink.exe"

Write-Host "=== DEPLOY SIDEBAR ANIMATION ===" -ForegroundColor Cyan

# 1. Upload global CSS
Write-Host "`n[1/3] Uploading global-header-sidebar.css..." -ForegroundColor Yellow
& $PSCP -pw $PASS "$LOCAL\public\css\global-header-sidebar.css" "${VPS}:${REMOTE}/public/css/global-header-sidebar.css"

# 2. Upload sidebar-click-animation.js
Write-Host "`n[2/3] Uploading sidebar-click-animation.js..." -ForegroundColor Yellow
& $PSCP -pw $PASS "$LOCAL\public\js\sidebar-click-animation.js" "${VPS}:${REMOTE}/public/js/sidebar-click-animation.js"

# 3. Upload ALL modified HTML files (modules that have sidebars)
Write-Host "`n[3/3] Uploading module HTML files..." -ForegroundColor Yellow

# Vendas
$vendas = @("index.html","pedidos.html","clientes.html","estoque.html","prospeccao.html","prospeccao_backup.html","dashboard.html","dashboard-admin.html","comissoes.html","relatorios.html")
foreach ($f in $vendas) {
    Write-Host "  Vendas: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\Vendas\public\$f" "${VPS}:${REMOTE}/modules/Vendas/public/$f"
}

# Financeiro (root)
$finRoot = @("index.html","contas-pagar.html","contas-receber.html","fluxo-caixa.html","bancos.html","plano-contas.html","orcamentos.html","conciliacao.html","relatorios.html","centros-custo.html","impostos.html")
foreach ($f in $finRoot) {
    Write-Host "  Financeiro: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\Financeiro\$f" "${VPS}:${REMOTE}/modules/Financeiro/$f"
}

# Financeiro (public)
$finPub = @("index.html","contas_pagar.html","contas_receber.html","contas_bancarias.html","fluxo_caixa.html","relatorios.html")
foreach ($f in $finPub) {
    Write-Host "  Financeiro/public: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\Financeiro\public\$f" "${VPS}:${REMOTE}/modules/Financeiro/public/$f"
}

# Compras (root - non-public pages)
$comprasRoot = @("index.html","index-new.html","pedidos.html","cotacoes.html","fornecedores.html","requisicoes.html","recebimento.html","relatorios.html","materias-primas.html","dashboard-pro.html","dashboard-executivo.html","gestao-estoque.html","otimizacao-estoque.html")
foreach ($f in $comprasRoot) {
    Write-Host "  Compras: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\Compras\$f" "${VPS}:${REMOTE}/modules/Compras/$f"
}

# Compras (public)
Write-Host "  Compras/public: index.html" -ForegroundColor Gray
& $PSCP -pw $PASS "$LOCAL\modules\Compras\public\index.html" "${VPS}:${REMOTE}/modules/Compras/public/index.html"

# Faturamento (public)
$fatPub = @("index.html","dashboard.html","emitir.html","consultar.html","danfe.html","nfse.html","logistica.html","eventos.html","inutilizacao.html","regua.html","pix.html","relatorios.html")
foreach ($f in $fatPub) {
    Write-Host "  Faturamento/public: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\Faturamento\public\$f" "${VPS}:${REMOTE}/modules/Faturamento/public/$f"
}

# NFe
$nfe = @("index.html","emitir.html","consultar.html","danfe.html","nfse.html","relatorios.html","eventos.html","logistica.html","inutilizacao.html")
foreach ($f in $nfe) {
    Write-Host "  NFe: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\NFe\$f" "${VPS}:${REMOTE}/modules/NFe/$f"
}

# PCP (main files)
$pcpMain = @("index.html","index_new.html","ordens-producao.html","apontamentos.html","relatorios-apontamentos.html")
foreach ($f in $pcpMain) {
    Write-Host "  PCP: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\PCP\$f" "${VPS}:${REMOTE}/modules/PCP/$f"
}

# PCP (pages)
$pcpPages = @("estoque.html","materiais.html","ordem-compra.html","gestao-producao.html","faturamento.html","relatorios.html")
foreach ($f in $pcpPages) {
    Write-Host "  PCP/pages: $f" -ForegroundColor Gray
    & $PSCP -pw $PASS "$LOCAL\modules\PCP\pages\$f" "${VPS}:${REMOTE}/modules/PCP/pages/$f"
}

# Consultoria
Write-Host "  Consultoria: acesso.html" -ForegroundColor Gray
& $PSCP -pw $PASS "$LOCAL\modules\Consultoria\acesso.html" "${VPS}:${REMOTE}/modules/Consultoria/acesso.html"

# Admin
Write-Host "  Admin: permissoes.html" -ForegroundColor Gray
& $PSCP -pw $PASS "$LOCAL\modules\Admin\public\pages\permissoes.html" "${VPS}:${REMOTE}/modules/Admin/public/pages/permissoes.html"

# 4. Restart PM2
Write-Host "`n[4/4] Restarting PM2..." -ForegroundColor Yellow
& $PLINK -pw $PASS $VPS "cd /var/www/aluforce && pm2 restart aluforce-dashboard --update-env"

Write-Host "`n=== DEPLOY COMPLETE ===" -ForegroundColor Green
Write-Host "Sidebar animation applied to ALL modules (except RH)" -ForegroundColor Green
