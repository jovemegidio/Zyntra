$problemas = @()
$corretos = @()

$arquivos = @(
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\dashboard-executivo.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\dashboard-pro.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\fornecedores.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\gestao-estoque.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\materiais.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\otimizacao-estoque.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\pedidos.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\relatorios.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\requisicoes.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Compras\cotacoes.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\public\contas_bancarias.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\public\contas_pagar.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\public\contas_receber.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\public\fluxo_caixa.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\public\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\public\relatorios.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\bancos.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\conciliacao.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\contas-pagar.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\contas-receber.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\fluxo-caixa.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Financeiro\relatorios.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\certificado.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\consultar.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\danfe.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\emitir.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\eventos.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\inutilizacao.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\logistica.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\nfe.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\nfse.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\NFe\relatorios.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\PCP\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\PCP\ordens-producao.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\RH\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\RH\public\pages\dados-cadastrais.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\RH\public\pages\dashboard.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\RH\public\areaadm.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\RH\public\funcionario.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\clientes.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\dashboard-admin.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\dashboard.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\index.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\pedidos.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\relatorios.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\estoque.html",
    "C:\Users\egidio\Documents\Sistema - ALUFORCE - V.2\modules\Vendas\public\kanban.html"
)

foreach ($arquivo in $arquivos) {
    if (Test-Path $arquivo) {
        $conteudo = Get-Content $arquivo -Raw -ErrorAction SilentlyContinue
        
        $temUsuarioEstatico = $conteudo -match "Olá,?\s*Usuário|>Usuário<"
        $temCarregamentoUser = $conteudo -match "carregarUsuario|initUserHeader|user-loader\.js|carregarDadosUsuario|loadUserData|carregarNomeUsuario|userData.*localStorage|localStorage.*userData"
        
        $nomeArquivo = Split-Path $arquivo -Leaf
        $pastaModulo = ($arquivo -split "\\modules\\")[1] -replace "\\$nomeArquivo$", ""
        
        if ($temUsuarioEstatico -and -not $temCarregamentoUser) {
            $problemas += "$pastaModulo\$nomeArquivo"
        } elseif ($temUsuarioEstatico -and $temCarregamentoUser) {
            $corretos += "$pastaModulo\$nomeArquivo"
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Red
Write-Host " ARQUIVOS COM PROBLEMA (PRECISAM CORRECAO)" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""

if ($problemas.Count -eq 0) {
    Write-Host "Nenhum arquivo problematico encontrado!" -ForegroundColor Green
} else {
    foreach ($p in $problemas) {
        Write-Host "  - $p" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Total: $($problemas.Count) arquivo(s)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " ARQUIVOS CORRETOS (TEM CARREGAMENTO)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

foreach ($c in $corretos) {
    Write-Host "  - $c" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "Total: $($corretos.Count) arquivo(s)" -ForegroundColor Cyan
