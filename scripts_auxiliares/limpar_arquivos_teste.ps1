ta# Script de limpeza de arquivos de teste e temporários
# Execute com: .\limpar_arquivos_teste.ps1

$rootPath = "c:\Users\Administrator\Desktop\Sistema - ALUFORCE - V.2"

Write-Host "=== LIMPEZA DE ARQUIVOS DE TESTE ===" -ForegroundColor Cyan

# Padrões de arquivos a remover
$patterns = @(
    "teste-*.js",
    "teste-*.html",
    "test-*.js", 
    "test-*.html",
    "debug-*.js",
    "debug-*.html",
    "*.bak",
    "*.backup",
    "*.old",
    "*.tmp",
    "analise_*.js",
    "analisar_*.js",
    "verificar_*.js",
    "corrigir_*.js",
    "aplicar_*.js",
    "criar_*.js",
    "atualizar_*.js",
    "adicionar_*.js",
    "importar_*.js",
    "exportar_*.js",
    "gerar_*.js",
    "testar_*.js"
)

# Pastas a ignorar
$ignoreFolders = @(
    "node_modules",
    ".git",
    "exceljs-real"
)

$totalRemoved = 0

foreach ($pattern in $patterns) {
    $files = Get-ChildItem -Path $rootPath -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue | 
        Where-Object { 
            $path = $_.FullName
            $ignore = $false
            foreach ($folder in $ignoreFolders) {
                if ($path -like "*\$folder\*") { $ignore = $true; break }
            }
            -not $ignore
        }
    
    foreach ($file in $files) {
        Write-Host "Removendo: $($file.Name)" -ForegroundColor Yellow
        Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
        $totalRemoved++
    }
}

# Arquivos específicos a remover
$specificFiles = @(
    "testes_completos_10_10.js",
    "analisar_template.js",
    "backup_*.sql"
)

foreach ($pattern in $specificFiles) {
    $files = Get-ChildItem -Path $rootPath -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $path = $_.FullName
            $ignore = $false
            foreach ($folder in $ignoreFolders) {
                if ($path -like "*\$folder\*") { $ignore = $true; break }
            }
            -not $ignore
        }
    
    foreach ($file in $files) {
        Write-Host "Removendo: $($file.Name)" -ForegroundColor Yellow
        Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
        $totalRemoved++
    }
}

# Remover pasta exceljs-real (biblioteca desnecessária duplicada)
$exceljsPath = Join-Path $rootPath "exceljs-real"
if (Test-Path $exceljsPath) {
    Write-Host "Removendo pasta exceljs-real (biblioteca duplicada)..." -ForegroundColor Magenta
    Remove-Item $exceljsPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Pasta exceljs-real removida" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== LIMPEZA CONCLUÍDA ===" -ForegroundColor Green
Write-Host "Total de arquivos removidos: $totalRemoved" -ForegroundColor Cyan
