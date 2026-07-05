$s = "C:\Windows\System32\OpenSSH\scp.exe"
$k = "$env:USERPROFILE\.ssh\id_ed25519_vps"
$v = "root@31.97.64.102"

$deploys = @(
  @("Zyntra-SGE\Empresas\dashboard.html", "/var/www/labor-eletric/Zyntra-SGE/Empresas/dashboard.html"),
  @("Zyntra-SGE\Empresas\dashboard.html", "/var/www/labor-energy/Zyntra-SGE/Empresas/dashboard.html"),
  @("Zyntra-SGE\Empresas\minha-conta.html", "/var/www/labor-eletric/Zyntra-SGE/Empresas/minha-conta.html"),
  @("Zyntra-SGE\Empresas\minha-conta.html", "/var/www/labor-energy/Zyntra-SGE/Empresas/minha-conta.html"),
  @("Zyntra-SGE\js\dashboard.js", "/var/www/labor-eletric/Zyntra-SGE/js/dashboard.js"),
  @("Zyntra-SGE\js\dashboard.js", "/var/www/labor-energy/Zyntra-SGE/js/dashboard.js"),
  @("Zyntra-SGE\js\minha-conta.js", "/var/www/labor-eletric/Zyntra-SGE/js/minha-conta.js"),
  @("Zyntra-SGE\js\minha-conta.js", "/var/www/labor-energy/Zyntra-SGE/js/minha-conta.js"),
  @("Zyntra-SGE\js\chat-suporte.js", "/var/www/labor-eletric/Zyntra-SGE/js/chat-suporte.js"),
  @("Zyntra-SGE\js\chat-suporte.js", "/var/www/labor-energy/Zyntra-SGE/js/chat-suporte.js"),
  @("Zyntra-SGE\css\dashboard.css", "/var/www/labor-eletric/Zyntra-SGE/css/dashboard.css"),
  @("Zyntra-SGE\css\dashboard.css", "/var/www/labor-energy/Zyntra-SGE/css/dashboard.css"),
  @("Zyntra-SGE\css\pages-app.css", "/var/www/labor-eletric/Zyntra-SGE/css/pages-app.css"),
  @("Zyntra-SGE\css\pages-app.css", "/var/www/labor-energy/Zyntra-SGE/css/pages-app.css"),
  @("Zyntra-SGE\css\treinamentos.css", "/var/www/labor-eletric/Zyntra-SGE/css/treinamentos.css"),
  @("Zyntra-SGE\css\treinamentos.css", "/var/www/labor-energy/Zyntra-SGE/css/treinamentos.css"),
  @("modules\NFe\danfe.html", "/var/www/labor-energy/modules/NFe/danfe.html"),
  @("modules\RH\public\pages\relatorios.html", "/var/www/aluforce/modules/RH/public/pages/relatorios.html"),
  @("modules\RH\public\pages\relatorios.html", "/var/www/labor-eletric/modules/RH/public/pages/relatorios.html"),
  @("modules\RH\public\pages\relatorios.html", "/var/www/labor-energy/modules/RH/public/pages/relatorios.html"),
  @("modules\Compras\qrcode-estoque.html", "/var/www/aluforce/modules/Compras/qrcode-estoque.html"),
  @("modules\Compras\qrcode-estoque.html", "/var/www/labor-eletric/modules/Compras/qrcode-estoque.html"),
  @("modules\Compras\qrcode-estoque.html", "/var/www/labor-energy/modules/Compras/qrcode-estoque.html")
)

foreach ($d in $deploys) {
  & $s -o StrictHostKeyChecking=no -i $k $d[0] "${v}:$($d[1])"
  Write-Host "$($d[0]) -> $($d[1]) : exit=$LASTEXITCODE"
}
Write-Host "All done"
