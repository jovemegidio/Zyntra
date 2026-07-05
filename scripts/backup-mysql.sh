#!/usr/bin/env bash
# Daily MySQL backup for the three production instances.

set -uo pipefail
umask 077
shopt -s nullglob

BACKUP_DIR="${BACKUP_DIR:-/var/backups/aluforce/mysql}"
LOG_FILE="${LOG_FILE:-/var/log/aluforce/backup-mysql.log}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DAY_OF_WEEK="$(date +%u)"

ENV_FILES=(
    "/var/www/aluforce/.env"
    "/var/www/labor-energy/.env"
    "/var/www/labor-eletric/.env"
)

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

read_env_value() {
    local env_file="$1"
    local key="$2"
    local value

    value="$(sed -n "s/^${key}=//p" "$env_file" | tail -1 | tr -d '\r')"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
    fi
    printf '%s' "$value"
}

write_mysql_config() {
    local config_file="$1"
    local host="$2"
    local port="$3"
    local user="$4"
    local password="$5"
    local escaped_password

    escaped_password="${password//\\/\\\\}"
    escaped_password="${escaped_password//\"/\\\"}"

    {
        printf '[client]\n'
        printf 'host=%s\n' "$host"
        printf 'port=%s\n' "$port"
        printf 'user=%s\n' "$user"
        printf 'password="%s"\n' "$escaped_password"
        printf 'protocol=tcp\n'
    } >"$config_file"
    chmod 600 "$config_file"
}

trim_backups() {
    local directory="$1"
    local database="$2"
    local keep="$3"
    local files
    local remove_count

    files=("$directory/${database}_"*.sql.gz)
    remove_count=$((${#files[@]} - keep))
    if ((remove_count <= 0)); then
        return
    fi

    for ((i = 0; i < remove_count; i++)); do
        rm -f -- "${files[$i]}"
    done
    log "Removed $remove_count old backup(s) for $database"
}

log "=== MySQL backup started ==="

errors=0
backed_up_databases=()

for env_file in "${ENV_FILES[@]}"; do
    if [[ ! -r "$env_file" ]]; then
        log "ERROR: environment file not found: $env_file"
        errors=$((errors + 1))
        continue
    fi

    db_host="$(read_env_value "$env_file" DB_HOST)"
    db_port="$(read_env_value "$env_file" DB_PORT)"
    db_user="$(read_env_value "$env_file" DB_USER)"
    db_password="$(read_env_value "$env_file" DB_PASSWORD)"
    db_name="$(read_env_value "$env_file" DB_NAME)"
    [[ -z "$db_name" ]] && db_name="$(read_env_value "$env_file" DB_DATABASE)"
    [[ -z "$db_host" ]] && db_host="127.0.0.1"
    [[ -z "$db_port" ]] && db_port="3306"

    if [[ -z "$db_user" || -z "$db_password" || -z "$db_name" ]]; then
        log "ERROR: incomplete database configuration in $env_file"
        errors=$((errors + 1))
        continue
    fi

    mysql_config="$(mktemp)"
    write_mysql_config "$mysql_config" "$db_host" "$db_port" "$db_user" "$db_password"
    dump_file="$BACKUP_DIR/daily/${db_name}_${TIMESTAMP}.sql.gz"

    log "Exporting $db_name..."
    if mysqldump --defaults-extra-file="$mysql_config" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        --add-drop-table \
        --no-tablespaces \
        --set-gtid-purged=OFF \
        "$db_name" | gzip -c >"$dump_file" &&
        gzip -t "$dump_file"; then
        size="$(du -h "$dump_file" | cut -f1)"
        log "OK: $db_name -> $dump_file ($size)"
        backed_up_databases+=("$db_name")

        if [[ "$DAY_OF_WEEK" -eq 7 ]]; then
            weekly_file="$BACKUP_DIR/weekly/${db_name}_${TIMESTAMP}.sql.gz"
            cp "$dump_file" "$weekly_file"
            log "Weekly copy: $weekly_file"
        fi
    else
        log "ERROR: failed to export $db_name"
        rm -f "$dump_file"
        errors=$((errors + 1))
    fi

    rm -f "$mysql_config"
done

for database in "${backed_up_databases[@]}"; do
    trim_backups "$BACKUP_DIR/daily" "$database" "$RETENTION_DAILY"
    trim_backups "$BACKUP_DIR/weekly" "$database" "$RETENTION_WEEKLY"
done

daily_size="$(du -sh "$BACKUP_DIR/daily" 2>/dev/null | cut -f1)"
weekly_size="$(du -sh "$BACKUP_DIR/weekly" 2>/dev/null | cut -f1)"
disk_free="$(df -h / | awk 'NR == 2 {print $4}')"

log "=== MySQL backup finished ==="
log "Daily: ${daily_size:-0} | Weekly: ${weekly_size:-0} | Free disk: ${disk_free:-unknown}"

if ((errors > 0)); then
    log "ERROR: $errors database backup(s) failed"
    exit 1
fi

log "OK: ${#backed_up_databases[@]} database(s) backed up"
