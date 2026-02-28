$base = "g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"
$files = Get-ChildItem -Recurse -Filter "*.html" -Path "$base\modules" | Where-Object { $_.FullName -notmatch "_backup|backups|node_modules|dashboard-modern" }
Write-Host "=== VERIFICACAO FINAL ===" -ForegroundColor Cyan
Write-Host "Total HTML: $($files.Count)"

Write-Host "`n1. container-principal (deve ser 0):" -ForegroundColor Yellow
$count = 0
foreach ($f in $files) {
    if (Select-String -Path $f.FullName -Pattern 'class="container-principal"' -Quiet) {
        Write-Host "  FAIL: $($f.FullName)" -ForegroundColor Red
        $count++
    }
}
Write-Host "  Encontrados: $count"

Write-Host "`n2. topbar (deve ser 0):" -ForegroundColor Yellow
$count = 0
foreach ($f in $files) {
    if (Select-String -Path $f.FullName -Pattern 'class="topbar"' -Quiet) {
        Write-Host "  FAIL: $($f.FullName)" -ForegroundColor Red
        $count++
    }
}
Write-Host "  Encontrados: $count"

Write-Host "`n3. Sem mobile-menu-btn:" -ForegroundColor Yellow
$count = 0
foreach ($f in $files) {
    $hasHeader = Select-String -Path $f.FullName -Pattern 'class="header"' -Quiet
    $hasMobile = Select-String -Path $f.FullName -Pattern 'mobile-menu-btn' -Quiet
    if ($hasHeader -and -not $hasMobile) {
        Write-Host "  MISSING: $($f.Name)" -ForegroundColor Red
        $count++
    }
}
Write-Host "  Faltando: $count"

Write-Host "`n4. Sem sidebar-overlay:" -ForegroundColor Yellow
$count = 0
foreach ($f in $files) {
    $hasSidebar = Select-String -Path $f.FullName -Pattern 'class="sidebar"' -Quiet
    $hasOverlay = Select-String -Path $f.FullName -Pattern 'sidebar-overlay' -Quiet
    if ($hasSidebar -and -not $hasOverlay) {
        Write-Host "  MISSING: $($f.Name)" -ForegroundColor Red
        $count++
    }
}
Write-Host "  Faltando: $count"

Write-Host "`n5. mainSidebar antigo:" -ForegroundColor Yellow
$count = 0
foreach ($f in $files) {
    if (Select-String -Path $f.FullName -Pattern 'id="mainSidebar"' -Quiet) {
        Write-Host "  OLD: $($f.Name)" -ForegroundColor Red
        $count++
    }
}
Write-Host "  Encontrados: $count"

Write-Host "`nDONE" -ForegroundColor Green
