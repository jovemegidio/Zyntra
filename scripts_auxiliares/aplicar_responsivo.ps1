# ALUFORCE - Aplicar CSS/JS Responsivos em Todos os Módulos
# Este script adiciona os arquivos de CSS e JS responsivos em todas as páginas HTML

$rootPath = "C:\Users\egidio\Music\Sistema - ALUFORCE - V.2"

# Arquivos a serem adicionados
$cssResponsive = @'
    <!-- CSS Responsivo - Mobile e Tablet -->
    <link rel="stylesheet" href="/css/responsive.css?v=20260106">
    <link rel="stylesheet" href="/css/modules-responsive.css?v=20260106">
'@

$jsResponsive = @'
    <!-- JS Responsivo - Mobile -->
    <script src="/js/mobile-responsive.js?v=20260106" defer></script>
'@

# Função para adicionar CSS antes do </head>
function Add-ResponsiveAssets {
    param([string]$filePath)
    
    if (-not (Test-Path $filePath)) {
        Write-Host "Arquivo não encontrado: $filePath" -ForegroundColor Yellow
        return
    }
    
    $content = Get-Content $filePath -Raw -Encoding UTF8
    
    # Verificar se já foi adicionado
    if ($content -match "responsive\.css") {
        Write-Host "Já processado: $filePath" -ForegroundColor Gray
        return
    }
    
    # Adicionar CSS antes do </head>
    $content = $content -replace "</head>", "$cssResponsive`n$jsResponsive`n</head>"
    
    # Salvar arquivo
    $content | Set-Content $filePath -Encoding UTF8 -NoNewline
    
    Write-Host "Atualizado: $filePath" -ForegroundColor Green
}

# Encontrar todos os arquivos HTML
$htmlFiles = @(
    # Painel de Controle
    "$rootPath\public\index.html",
    "$rootPath\public\login.html",
    "$rootPath\public\config.html",
    "$rootPath\public\admin\*.html",
    
    # Módulos
    "$rootPath\modules\Compras\index.html",
    "$rootPath\modules\Compras\*.html",
    "$rootPath\modules\Compras\public\index.html",
    
    "$rootPath\modules\PCP\index.html",
    "$rootPath\modules\PCP\*.html",
    
    "$rootPath\modules\Financeiro\index.html",
    "$rootPath\modules\Financeiro\*.html",
    "$rootPath\modules\Financeiro\public\index.html",
    
    "$rootPath\modules\RH\index.html",
    "$rootPath\modules\RH\*.html",
    
    "$rootPath\modules\NFe\index.html",
    "$rootPath\modules\NFe\*.html",
    
    "$rootPath\modules\Vendas\index.html",
    "$rootPath\modules\Vendas\public\index.html",
    
    "$rootPath\modules\Faturamento\public\index.html"
)

Write-Host "=== ALUFORCE - Aplicar CSS/JS Responsivos ===" -ForegroundColor Cyan
Write-Host ""

foreach ($pattern in $htmlFiles) {
    $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        Add-ResponsiveAssets -filePath $file.FullName
    }
}

Write-Host ""
Write-Host "=== Concluído! ===" -ForegroundColor Cyan
