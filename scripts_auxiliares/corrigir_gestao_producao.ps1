# Corrigir encoding e layout da página Gestão de Produção
$filePath = "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2\modules\PCP\index.html"

# Ler o arquivo com encoding UTF-8
$content = Get-Content -Path $filePath -Raw -Encoding UTF8

# Substituições de encoding corrompido
$content = $content -replace 'GestÃ£o de ProduÃ§Ã£o', 'Gestão de Produção'
$content = $content -replace 'Tempo Total de ProduÃ§Ã£o', 'Tempo Total de Produção'
$content = $content -replace 'Este mÃªs', 'Este mês'
$content = $content -replace 'MÃ¡quinas Ativas', 'Máquinas Ativas'
$content = $content -replace 'EficiÃªncia MÃ©dia', 'Eficiência Média'
$content = $content -replace 'NÃºmero do pedido', 'Número do pedido'
$content = $content -replace 'PerÃ­odo', 'Período'
$content = $content -replace 'Este MÃªs', 'Este Mês'
$content = $content -replace 'MÃ¡quina', 'Máquina'
$content = $content -replace 'Todas as MÃ¡quinas', 'Todas as Máquinas'
$content = $content -replace 'Registros de ProduÃ§Ã£o', 'Registros de Produção'
$content = $content -replace 'NÂº Pedido', 'Nº Pedido'
$content = $content -replace 'Tempo de ProduÃ§Ã£o', 'Tempo de Produção'
$content = $content -replace 'MÃ¡quinas Utilizadas', 'Máquinas Utilizadas'
$content = $content -replace 'AÃ§Ãµes', 'Ações'
$content = $content -replace 'produÃ§Ã£o', 'produção'
$content = $content -replace 'SeÃ§Ã£o de MÃ¡quinas', 'Seção de Máquinas'
$content = $content -replace 'CÃ³digo', 'Código'
$content = $content -replace 'Nome da MÃ¡quina', 'Nome da Máquina'
$content = $content -replace 'Ãšltima ManutenÃ§Ã£o', 'Última Manutenção'
$content = $content -replace 'mÃ¡quinas', 'máquinas'

# Remover o título e manter só os botões (ajustar o header)
$oldHeader = @'
                <div class="page-header">
                    <div class="page-header-top" style="justify-content: space-between;">
                        <h2 class="page-title" style="display: flex; align-items: center; gap: 12px; margin: 0; font-size: 20px; font-weight: 700; color: var(--gray-800);">
                            <i class="fas fa-industry" style="color: var(--primary-500);"></i> Gestão de Produção
                        </h2>
                        <div class="page-actions">
                            <button class="btn btn-secondary" onclick="atualizarDadosGestao()">
                                <i class="fas fa-sync-alt"></i> Atualizar
                            </button>
                            <button class="btn btn-primary" onclick="exportarGestaoProducao()">
                                <i class="fas fa-file-excel"></i> Exportar
                            </button>
                        </div>
                    </div>
                </div>
'@

$newHeader = @'
                <div class="page-header">
                    <div class="page-header-top" style="justify-content: flex-end;">
                        <div class="page-actions">
                            <button class="btn btn-secondary" onclick="atualizarDadosGestao()">
                                <i class="fas fa-sync-alt"></i> Atualizar
                            </button>
                            <button class="btn btn-primary" onclick="exportarGestaoProducao()">
                                <i class="fas fa-file-excel"></i> Exportar
                            </button>
                        </div>
                    </div>
                </div>
'@

$content = $content -replace [regex]::Escape($oldHeader), $newHeader

# Salvar o arquivo com encoding UTF-8 sem BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($filePath, $content, $utf8NoBom)

Write-Host "Arquivo corrigido com sucesso!" -ForegroundColor Green
