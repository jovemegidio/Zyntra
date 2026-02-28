$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open("G:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2\Arvore de Produto com Custo\Lista de Estoque - Aluforce Cabos.xlsx")
$ws = $wb.Sheets.Item(1)
$usedRange = $ws.UsedRange
$rows = $usedRange.Rows.Count
$cols = $usedRange.Columns.Count

# Collect unique product codes and aggregate quantities
$products = @{}
for ($r = 5; $r -le $rows; $r++) {
    $cod = $ws.Cells.Item($r, 1).Text.Trim()
    $nome = $ws.Cells.Item($r, 2).Text.Trim()
    $qtde = $ws.Cells.Item($r, 3).Text.Trim()
    
    if ($cod -eq "" -or $cod -eq $null) { continue }
    
    $qty = 0
    try { $qty = [double]$qtde } catch {}
    
    if ($products.ContainsKey($cod)) {
        $products[$cod].Quantidade += $qty
        $products[$cod].Bobinas += 1
    } else {
        $products[$cod] = @{
            Codigo = $cod
            Nome = $nome
            Quantidade = $qty
            Bobinas = 1
        }
    }
}

Write-Host "=== PRODUTOS UNICOS NO EXCEL (AGREGADOS) ==="
Write-Host "Total de produtos unicos: $($products.Count)"
Write-Host ""
Write-Host "COD | NOME | QTD TOTAL | BOBINAS"
Write-Host "-------------------------------------------"
$products.GetEnumerator() | Sort-Object { $_.Key } | ForEach-Object {
    $p = $_.Value
    Write-Host "$($p.Codigo) | $($p.Nome) | $($p.Quantidade) | $($p.Bobinas)"
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
