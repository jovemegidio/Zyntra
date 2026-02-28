$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open("G:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2\Arvore de Produto com Custo\Lista de Estoque - Aluforce Cabos.xlsx")
$ws = $wb.Sheets.Item(1)
$usedRange = $ws.UsedRange
$rows = $usedRange.Rows.Count
$cols = $usedRange.Columns.Count
Write-Host "Rows: $rows, Cols: $cols"
Write-Host "---HEADER---"
for ($r = 1; $r -le [Math]::Min($rows, 80); $r++) {
    $line = ""
    for ($c = 1; $c -le [Math]::Min($cols, 15); $c++) {
        $val = $ws.Cells.Item($r, $c).Text
        if ($c -gt 1) { $line += "|" }
        $line += $val
    }
    Write-Host $line
}
$wb.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
