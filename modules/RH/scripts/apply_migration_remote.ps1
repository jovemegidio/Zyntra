Param()
Write-Host "Script remoto PSD para aplicar migration via SSH (Windows). Configure variáveis de ambiente antes de executar: PROD_HOST, PROD_USER, SSH_KEY, REMOTE_PROJECT_PATH, DB_USER, DB_PASS (opcional)"
$PROD_HOST = $env:PROD_HOST
$PROD_USER = $env:PROD_USER
$SSH_KEY = $env:SSH_KEY
$REMOTE_PROJECT_PATH = $env:REMOTE_PROJECT_PATH
if ([string]::IsNullOrWhiteSpace($REMOTE_PROJECT_PATH)) { $REMOTE_PROJECT_PATH = '/var/www/recursos-humanos' }
$DB_USER = $env:DB_USER
if ([string]::IsNullOrWhiteSpace($DB_USER)) { $DB_USER = 'root' }
$DB_PASS = $env:DB_PASS

if ([string]::IsNullOrWhiteSpace($PROD_HOST) -or [string]::IsNullOrWhiteSpace($PROD_USER)) {
    Write-Error "Defina as variáveis de ambiente PROD_HOST e PROD_USER antes de executar."
    exit 2
}

$sshCmd = "ssh"
$scpCmd = "scp"
if (-not [string]::IsNullOrWhiteSpace($SSH_KEY)) {
    $sshCmd = "$sshCmd -i $SSH_KEY"
    $scpCmd = "$scpCmd -i $SSH_KEY"
}

$remoteScript = @'
set -euo pipefail
DB_USER="{0}"
DB_PASS="{1}"
DB_NAME="aluforce_vendas"
MIGRATION="{2}/migrations/20250819_add_personal_fields.sql"
BACKUP="/tmp/funcionarios.backup.sql"

if [[ -n "$DB_PASS" ]]; then
  mysqldump -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" funcionarios > "$BACKUP"
else
  mysqldump -u "$DB_USER" -p "$DB_NAME" funcionarios > "$BACKUP"
fi

mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$MIGRATION"
'@ -f $DB_USER, $DB_PASS, $REMOTE_PROJECT_PATH

$tmp = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tmp -Value $remoteScript -Encoding UTF8

$remoteTmp = "/tmp/apply_migration_remote.sh"
& $scpCmd $tmp "$PROD_USER@$PROD_HOST:$remoteTmp"
& $sshCmd "$PROD_USER@$PROD_HOST" "bash $remoteTmp; rm -f $remoteTmp"

Remove-Item $tmp
Write-Host "Remote migration executed. Verify backup and run smoke tests."

