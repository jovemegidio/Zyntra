Param()
Write-Host "Script seguro para backup e aplicação da migration: migrations/20250819_add_personal_fields.sql"
$User = Read-Host "MySQL user (default: root)"
if ([string]::IsNullOrWhiteSpace($User)) { $User = 'root' }
Write-Host "Ocorre uma solicitação de password interativa — insira a password do MySQL quando solicitado."
Write-Host "Fazendo backup da tabela 'funcionarios' para 'funcionarios.backup.sql'..."
& mysqldump -u $User -p aluforce_vendas funcionarios > funcionarios.backup.sql
if ($LASTEXITCODE -ne 0) { Write-Error "Erro no backup (mysqldump). Saindo."; exit $LASTEXITCODE }
Write-Host "Backup concluído com sucesso. Aplicando migration..."
	# PowerShell doesn't support '<' redirection for native executables; use cmd.exe to perform redirection
	$cmd = "mysql -u $User -p aluforce_vendas < \"migrations/20250819_add_personal_fields.sql\""
	cmd.exe /c $cmd
if ($LASTEXITCODE -ne 0) { Write-Error "Erro ao aplicar migration. Verifique o arquivo SQL e o DB."; exit $LASTEXITCODE }
Write-Host "Migration aplicada com sucesso. Execute: npm run smoke:full -- <email_test> <senha_test> <id_test>"

