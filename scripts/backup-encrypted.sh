#!/bin/bash
# =================================================================
# AUDIT-FIX R-22: Backup Criptografado — ALUFORCE ERP
# 
# Script de backup com criptografia AES-256 para conformidade LGPD
# Dados pessoais em backups devem ser protegidos (Art. 46, LGPD)
#
# Uso: ./backup-encrypted.sh [diretorio_destino]
# Requer: mysql, openssl instalados
#
# Criado durante auditoria de segurança — 15/02/2026
# =================================================================

set -euo pipefail

# Configurações
BACKUP_DIR="${1:-/var/www/aluforce/backups}"
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD}"
DB_NAME="${DB_NAME:-aluforce_vendas}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="aluforce_backup_${TIMESTAMP}"
RETENTION_DAYS=30

# Verificar dependências
command -v mysqldump >/dev/null 2>&1 || { echo "❌ mysqldump não encontrado"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "❌ openssl não encontrado"; exit 1; }

# Criar diretório de backup
mkdir -p "${BACKUP_DIR}"

echo "🔄 [BACKUP] Iniciando backup criptografado..."
echo "📅 Data: $(date)"
echo "🗄️ Database: ${DB_NAME}"
echo "📁 Destino: ${BACKUP_DIR}"

# 1. Dump do banco
echo "📤 Executando mysqldump..."
mysqldump \
    --host="${DB_HOST}" \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=OFF \
    "${DB_NAME}" > "${BACKUP_DIR}/${BACKUP_FILE}.sql"

SQL_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}.sql" | cut -f1)
echo "✅ Dump concluído: ${SQL_SIZE}"

# 2. Comprimir
echo "🗜️ Comprimindo..."
gzip "${BACKUP_DIR}/${BACKUP_FILE}.sql"
GZ_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}.sql.gz" | cut -f1)
echo "✅ Comprimido: ${GZ_SIZE}"

# 3. Criptografar com AES-256-CBC
echo "🔒 Criptografando com AES-256..."
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
    -in "${BACKUP_DIR}/${BACKUP_FILE}.sql.gz" \
    -out "${BACKUP_DIR}/${BACKUP_FILE}.sql.gz.enc" \
    -pass "pass:${ENCRYPTION_KEY}"

ENC_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}.sql.gz.enc" | cut -f1)
echo "✅ Criptografado: ${ENC_SIZE}"

# 4. Remover arquivo não criptografado
rm -f "${BACKUP_DIR}/${BACKUP_FILE}.sql.gz"
echo "🗑️ Arquivo não criptografado removido"

# 5. Gerar checksum
sha256sum "${BACKUP_DIR}/${BACKUP_FILE}.sql.gz.enc" > "${BACKUP_DIR}/${BACKUP_FILE}.sha256"
echo "📝 Checksum gerado"

# 6. Política de retenção — remover backups antigos
echo "🧹 Aplicando política de retenção (${RETENTION_DAYS} dias)..."
DELETED=$(find "${BACKUP_DIR}" -name "aluforce_backup_*.enc" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
find "${BACKUP_DIR}" -name "aluforce_backup_*.sha256" -mtime +${RETENTION_DAYS} -delete
echo "🗑️ ${DELETED} backup(s) antigo(s) removido(s)"

# 7. Resumo
echo ""
echo "════════════════════════════════════════════"
echo "✅ BACKUP CRIPTOGRAFADO CONCLUÍDO"
echo "════════════════════════════════════════════"
echo "📁 Arquivo: ${BACKUP_DIR}/${BACKUP_FILE}.sql.gz.enc"
echo "📏 Tamanho: ${ENC_SIZE}"
echo "🔐 Criptografia: AES-256-CBC (PBKDF2, 100k iterações)"
echo "📝 Checksum: ${BACKUP_DIR}/${BACKUP_FILE}.sha256"
echo ""
echo "⚠️  Para restaurar:"
echo "   openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \\"
echo "     -in ${BACKUP_FILE}.sql.gz.enc \\"
echo "     -out ${BACKUP_FILE}.sql.gz \\"
echo "     -pass 'pass:SUA_CHAVE'"
echo "   gunzip ${BACKUP_FILE}.sql.gz"
echo "   mysql -u root -p ${DB_NAME} < ${BACKUP_FILE}.sql"
echo "════════════════════════════════════════════"
