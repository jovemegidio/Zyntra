#!/usr/bin/env bash
# apply_migration_remote.sh
# Uso seguro: este script conecta-se ao servidor remoto via SSH e executa backup + aplica a migration.
# Configure as variáveis abaixo (ou exporte no ambiente):
#   PROD_HOST (ex: example.com)
#   PROD_USER (ex: deploy)
#   SSH_KEY (caminho para chave privada, opcional)
#   REMOTE_PROJECT_PATH (caminho absoluto onde o repo está no servidor)
#   DB_USER (ex: root)
#   DB_PASS (opcional — melhor usar .my.cnf no servidor para autenticação)
#   DB_NAME (default: aluforce_vendas)

set -euo pipefail

: ${PROD_HOST:=}
: ${PROD_USER:=}
: ${SSH_KEY:=}
: ${REMOTE_PROJECT_PATH:=/var/www/recursos-humanos}
: ${DB_USER:=root}
: ${DB_PASS:=}
: ${DB_NAME:=aluforce_vendas}

if [[ -z "$PROD_HOST" || -z "$PROD_USER" ]]; then
  echo "ERRO: defina PROD_HOST e PROD_USER no ambiente antes de executar. Ex: export PROD_HOST=meu-host && export PROD_USER=deploy"
  exit 2
fi

SSH_OPTS=()
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS+=( -i "$SSH_KEY" )
fi

REMOTE_MIGRATION_PATH="$REMOTE_PROJECT_PATH/migrations/20250819_add_personal_fields.sql"
REMOTE_BACKUP_PATH="/tmp/funcionarios.backup.sql"

echo "Conectando a $PROD_USER@$PROD_HOST e executando backup+migration (DB: $DB_NAME)..."

# Build remote script
read -r -d '' REMOTE_SCRIPT <<'REMOTE'
set -euo pipefail
DB_USER="$DB_USER"
DB_PASS_PLACEHOLDER='$DB_PASS_PLACEHOLDER'
DB_NAME="$DB_NAME"
MIGRATION="$REMOTE_MIGRATION_PATH"
BACKUP="$REMOTE_BACKUP_PATH"

# If DB_PASS_PLACEHOLDER is empty, mysql client will prompt interactively.
if [[ -n "$DB_PASS_PLACEHOLDER" ]]; then
  echo "Fazendo backup da tabela funcionarios..."
  mysqldump -u "$DB_USER" -p"$DB_PASS_PLACEHOLDER" "$DB_NAME" funcionarios > "$BACKUP"
else
  echo "Fazendo backup da tabela funcionarios (mysql irá pedir senha)..."
  mysqldump -u "$DB_USER" -p "$DB_NAME" funcionarios > "$BACKUP"
fi

if [[ ! -f "$MIGRATION" ]]; then
  echo "ERRO: arquivo de migration não encontrado em: $MIGRATION" >&2
  exit 3
fi

echo "Aplicando migration: $MIGRATION"
if [[ -n "$DB_PASS_PLACEHOLDER" ]]; then
  mysql -u "$DB_USER" -p"$DB_PASS_PLACEHOLDER" "$DB_NAME" < "$MIGRATION"
else
  mysql -u "$DB_USER" -p "$DB_NAME" < "$MIGRATION"
fi

echo "Migration aplicada. Backup salvo em: $BACKUP"
REMOTE

# Substitute placeholders into remote script safely
TMP_SCRIPT=$(mktemp)
printf '%s' "$REMOTE_SCRIPT" | sed \
  -e "s|\$DB_USER|$DB_USER|g" \
  -e "s|\$DB_NAME|$DB_NAME|g" \
  -e "s|\$REMOTE_MIGRATION_PATH|$REMOTE_MIGRATION_PATH|g" \
  -e "s|\$REMOTE_BACKUP_PATH|$REMOTE_BACKUP_PATH|g" \
  -e "s|\$DB_PASS_PLACEHOLDER|$DB_PASS|g" > "$TMP_SCRIPT"

# Copy the script to remote and execute
scp ${SSH_OPTS[*]} "$TMP_SCRIPT" "$PROD_USER@$PROD_HOST:/tmp/apply_migration_remote.sh"
ssh ${SSH_OPTS[*]} "$PROD_USER@$PROD_HOST" "bash /tmp/apply_migration_remote.sh && rm -f /tmp/apply_migration_remote.sh"

rm -f "$TMP_SCRIPT"

echo "Operação remota concluída. Verifique o backup e execute smoke tests conforme necessário."

echo "Sugestão: rodar localmente: npm run smoke:full -- <email_test> <senha_test> <id_test>"

exit 0
