#!/bin/bash
# ============================================================================
# ALUFORCE - Script para Importar Backup do Banco de Dados
# ============================================================================

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configurações padrão
DB_NAME="aluforce_vendas"
DB_USER="aluforce"
BACKUP_FILE=""

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[AVISO]${NC} $1"; }
log_error() { echo -e "${RED}[ERRO]${NC} $1"; }
log_step() { echo -e "${BLUE}[PASSO]${NC} $1"; }

show_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║          ALUFORCE - Importador de Backup MySQL              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Verificar argumentos
check_args() {
    if [ -z "$1" ]; then
        echo ""
        echo "Uso: $0 <arquivo_backup.sql>"
        echo ""
        echo "Exemplos:"
        echo "  $0 backup.sql"
        echo "  $0 /home/user/backups/aluforce_2026-01-20.sql"
        echo ""
        
        # Listar backups disponíveis
        echo "Backups encontrados no diretório atual:"
        ls -la *.sql 2>/dev/null || echo "  Nenhum arquivo .sql encontrado"
        echo ""
        exit 1
    fi
    
    BACKUP_FILE="$1"
    
    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Arquivo não encontrado: $BACKUP_FILE"
        exit 1
    fi
}

# Solicitar senha
ask_password() {
    echo ""
    read -sp "Digite a senha do usuário '$DB_USER': " DB_PASSWORD
    echo ""
}

# Verificar conexão
test_connection() {
    log_step "Verificando conexão com o banco..."
    
    if mysql -u${DB_USER} -p${DB_PASSWORD} -e "SELECT 1" ${DB_NAME} &> /dev/null; then
        log_info "Conexão OK!"
    else
        log_error "Não foi possível conectar ao banco de dados!"
        log_error "Verifique usuário e senha."
        exit 1
    fi
}

# Fazer backup antes de importar
backup_before_import() {
    log_step "Criando backup de segurança..."
    
    BACKUP_DIR="/opt/aluforce/backups"
    mkdir -p $BACKUP_DIR
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    SAFETY_BACKUP="$BACKUP_DIR/pre-import_${TIMESTAMP}.sql"
    
    mysqldump -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} > $SAFETY_BACKUP 2>/dev/null || true
    
    if [ -f "$SAFETY_BACKUP" ] && [ -s "$SAFETY_BACKUP" ]; then
        log_info "Backup de segurança criado: $SAFETY_BACKUP"
    else
        log_warn "Não havia dados para backup (banco vazio)"
    fi
}

# Importar backup
import_backup() {
    log_step "Importando backup: $BACKUP_FILE"
    
    # Obter tamanho do arquivo
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log_info "Tamanho do arquivo: $FILE_SIZE"
    
    echo ""
    log_warn "Isso irá SUBSTITUIR todos os dados existentes!"
    read -p "Deseja continuar? (s/N): " confirm
    
    if [ "$confirm" != "s" ] && [ "$confirm" != "S" ]; then
        log_info "Operação cancelada."
        exit 0
    fi
    
    echo ""
    log_info "Importando... (isso pode demorar alguns minutos)"
    
    # Importar com progress
    pv "$BACKUP_FILE" 2>/dev/null | mysql -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} || \
    mysql -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} < "$BACKUP_FILE"
    
    log_info "Importação concluída!"
}

# Verificar importação
verify_import() {
    log_step "Verificando importação..."
    
    # Contar tabelas
    TABLE_COUNT=$(mysql -u${DB_USER} -p${DB_PASSWORD} -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';" 2>/dev/null)
    
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  IMPORTAÇÃO CONCLUÍDA COM SUCESSO!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${YELLOW}Tabelas importadas:${NC} $TABLE_COUNT"
    echo ""
    
    # Listar algumas tabelas
    echo "  Principais tabelas:"
    mysql -u${DB_USER} -p${DB_PASSWORD} -N -e "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema='${DB_NAME}' ORDER BY table_rows DESC LIMIT 10;" 2>/dev/null | while read table rows; do
        printf "    %-30s %s registros\n" "$table" "$rows"
    done
    
    echo ""
}

# Main
main() {
    clear
    show_banner
    
    check_args "$@"
    ask_password
    test_connection
    backup_before_import
    import_backup
    verify_import
    
    log_info "Processo finalizado!"
}

main "$@"
