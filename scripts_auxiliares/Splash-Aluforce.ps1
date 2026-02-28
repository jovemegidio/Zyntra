# Splash Screen Aluforce ERP com Logo Real
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = Get-Location }

# Cores
$colorCyan = [System.Drawing.Color]::FromArgb(255, 0, 180, 200)
$colorDark = [System.Drawing.Color]::FromArgb(255, 20, 60, 100)
$colorWhite = [System.Drawing.Color]::White
$colorTextLight = [System.Drawing.Color]::FromArgb(255, 200, 230, 240)

# Criar form
$splash = New-Object System.Windows.Forms.Form
$splash.StartPosition = "CenterScreen"
$splash.FormBorderStyle = "None"
$splash.Size = New-Object System.Drawing.Size(450, 400)
$splash.TopMost = $true
$splash.ShowInTaskbar = $false

# Gradiente de fundo
$splash.Add_Paint({
    param($sender, $e)
    $rect = $sender.ClientRectangle
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $colorCyan, $colorDark, 
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $e.Graphics.FillRectangle($brush, $rect)
    $brush.Dispose()
})

# Carregar logo real
$logoPath = Join-Path $scriptDir "public\images\Logo Monocromatico - Branco - Aluforce.png"
if (-not (Test-Path $logoPath)) {
    $logoPath = Join-Path $scriptDir "modules\RH\public\Logo Monocromatico - Branco - Aluforce.png"
}
if (-not (Test-Path $logoPath)) {
    $logoPath = Join-Path $scriptDir "backup_old_images\Logo Monocromatico - Branco - Aluforce copy.png"
}

if (Test-Path $logoPath) {
    $picLogo = New-Object System.Windows.Forms.PictureBox
    $picLogo.Size = New-Object System.Drawing.Size(180, 180)
    $picLogo.Location = New-Object System.Drawing.Point(135, 30)
    $picLogo.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $picLogo.BackColor = [System.Drawing.Color]::Transparent
    try {
        $picLogo.Image = [System.Drawing.Image]::FromFile($logoPath)
    } catch {}
    $splash.Controls.Add($picLogo)
} else {
    # Fallback: circulo se logo nao encontrado
    $panelLogo = New-Object System.Windows.Forms.Panel
    $panelLogo.Size = New-Object System.Drawing.Size(120, 120)
    $panelLogo.Location = New-Object System.Drawing.Point(165, 50)
    $panelLogo.BackColor = [System.Drawing.Color]::Transparent
    $panelLogo.Add_Paint({
        param($sender, $e)
        $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $e.Graphics.FillEllipse([System.Drawing.Brushes]::White, 0, 0, 118, 118)
        $pen = New-Object System.Drawing.Pen($colorCyan, 4)
        $e.Graphics.DrawEllipse($pen, 15, 15, 88, 88)
        $pen.Dispose()
    })
    $splash.Controls.Add($panelLogo)
}

# Titulo
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "ALUFORCE"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 32, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = $colorWhite
$lblTitle.BackColor = [System.Drawing.Color]::Transparent
$lblTitle.AutoSize = $false
$lblTitle.Size = New-Object System.Drawing.Size(450, 55)
$lblTitle.Location = New-Object System.Drawing.Point(0, 220)
$lblTitle.TextAlign = "MiddleCenter"
$splash.Controls.Add($lblTitle)

# Subtitulo
$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "CABOS DE ALUMINIO"
$lblSub.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$lblSub.ForeColor = $colorTextLight
$lblSub.BackColor = [System.Drawing.Color]::Transparent
$lblSub.AutoSize = $false
$lblSub.Size = New-Object System.Drawing.Size(450, 25)
$lblSub.Location = New-Object System.Drawing.Point(0, 275)
$lblSub.TextAlign = "MiddleCenter"
$splash.Controls.Add($lblSub)

# Status
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Carregando sistema..."
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(255, 160, 200, 220)
$lblStatus.BackColor = [System.Drawing.Color]::Transparent
$lblStatus.AutoSize = $false
$lblStatus.Size = New-Object System.Drawing.Size(450, 25)
$lblStatus.Location = New-Object System.Drawing.Point(0, 350)
$lblStatus.TextAlign = "MiddleCenter"
$splash.Controls.Add($lblStatus)

# Barra de progresso customizada
$progressPanel = New-Object System.Windows.Forms.Panel
$progressPanel.Size = New-Object System.Drawing.Size(300, 6)
$progressPanel.Location = New-Object System.Drawing.Point(75, 330)
$progressPanel.BackColor = [System.Drawing.Color]::FromArgb(255, 40, 80, 120)
$splash.Controls.Add($progressPanel)

$progressBar = New-Object System.Windows.Forms.Panel
$progressBar.Size = New-Object System.Drawing.Size(0, 6)
$progressBar.Location = New-Object System.Drawing.Point(0, 0)
$progressBar.BackColor = $colorWhite
$progressPanel.Controls.Add($progressBar)

# Timer para animacao
$script:progress = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.Add_Tick({
    $script:progress += 5
    if ($script:progress -ge 300) {
        $timer.Stop()
        $splash.Close()
    } else {
        $progressBar.Size = New-Object System.Drawing.Size($script:progress, 6)
    }
})
$timer.Start()

[void]$splash.ShowDialog()
