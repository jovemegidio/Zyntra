#!/bin/bash
# ============================================================================
# ALUFORCE - Script de Instalação do MySQL no VPS
# ============================================================================
# Este script instala e configura o MySQL Server automaticamente
# Compatível com: Ubuntu 20.04, 22.04, 24.04 e Debian 10, 11, 12
# ============================================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações do banco de dados
DB_NAME="aluforce_vendas"
DB_USER="aluforce"
DB_PASSWORD=""

# Função para exibir banner
show_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║     █████╗ ██╗     ██╗   ██╗███████╗ ██████╗ ██████╗  ██████╗███████╗║"
    echo "║    ██╔══██╗██║     ██║   ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔════╝║"
    echo "║    ███████║██║     ██║   ██║█████╗  ██║   ██║██████╔╝██║     █████╗  ║"
    echo "║    ██╔══██║██║     ██║   ██║██╔══╝  ██║   ██║██╔══██╗██║     ██╔══╝  ║"
    echo "║    ██║  ██║███████╗╚██████╔╝██║     ╚██████╔╝██║  ██║╚██████╗███████╗║"
    echo "║    ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝║"
    echo "║                                                              ║"
    echo "║           Instalador MySQL para VPS - v1.0                   ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Função para log
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[PASSO]${NC} $1"
}

# Verificar se está rodando como root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Este script precisa ser executado como root (sudo)"
        echo "Execute: sudo bash instalar-mysql-vps.sh"
        exit 1
    fi
}

# Detectar sistema operacional
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
        log_info "Sistema detectado: $PRETTY_NAME"
    else
        log_error "Sistema operacional não suportado"
        exit 1
    fi
}

# Gerar senha segura
generate_password() {
    DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 20)
    log_info "Senha segura gerada automaticamente"
}

# Solicitar senha personalizada ou gerar automaticamente
ask_password() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  CONFIGURAÇÃO DE SENHA DO BANCO DE DADOS${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Escolha uma opção:"
    echo "  1) Gerar senha automaticamente (recomendado)"
    echo "  2) Definir senha manualmente"
    echo ""
    read -p "Opção [1]: " password_option
    password_option=${password_option:-1}
    
    if [ "$password_option" = "2" ]; then
        echo ""
        read -sp "Digite a senha para o usuário '$DB_USER': " DB_PASSWORD
        echo ""
        read -sp "Confirme a senha: " DB_PASSWORD_CONFIRM
        echo ""
        
        if [ "$DB_PASSWORD" != "$DB_PASSWORD_CONFIRM" ]; then
            log_error "As senhas não coincidem!"
            exit 1
        fi
        
        if [ ${#DB_PASSWORD} -lt 8 ]; then
            log_error "A senha deve ter no mínimo 8 caracteres!"
            exit 1
        fi
    else
        generate_password
    fi
}

# Atualizar sistema
update_system() {
    log_step "Atualizando sistema..."
    apt update -y
    apt upgrade -y
    log_info "Sistema atualizado com sucesso!"
}

# Instalar MySQL
install_mysql() {
    log_step "Instalando MySQL Server..."
    
    # Definir senha root do MySQL para instalação não-interativa
    MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 20)
    
    # Configurar debconf para instalação silenciosa
    export DEBIAN_FRONTEND=noninteractive
    
    # Instalar MySQL
    apt install mysql-server mysql-client -y
    
    # Iniciar e habilitar MySQL
    systemctl start mysql
    systemctl enable mysql
    
    log_info "MySQL instalado com sucesso!"
}

# Configurar segurança do MySQL
secure_mysql() {
    log_step "Configurando segurança do MySQL..."
    
    # Executar comandos de segurança via MySQL
    mysql -e "DELETE FROM mysql.user WHERE User='';"
    mysql -e "DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');"
    mysql -e "DROP DATABASE IF EXISTS test;"
    mysql -e "DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';"
    mysql -e "FLUSH PRIVILEGES;"
    
    log_info "Configurações de segurança aplicadas!"
}

# Criar banco de dados e usuário
create_database() {
    log_step "Criando banco de dados e usuário..."
    
    # Criar banco de dados
    mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    
    # Criar usuário
    mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
    
    # Conceder privilégios
    mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
    mysql -e "FLUSH PRIVILEGES;"
    
    log_info "Banco de dados '${DB_NAME}' criado!"
    log_info "Usuário '${DB_USER}' criado com todos os privilégios!"
}

# Otimizar configurações do MySQL
optimize_mysql() {
    log_step "Otimizando configurações do MySQL..."
    
    # Detectar RAM disponível
    TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
    
    # Calcular configurações baseadas na RAM
    if [ $TOTAL_RAM -lt 2048 ]; then
        # Menos de 2GB RAM
        INNODB_BUFFER="256M"
        MAX_CONNECTIONS="50"
    elif [ $TOTAL_RAM -lt 4096 ]; then
        # 2-4GB RAM
        INNODB_BUFFER="512M"
        MAX_CONNECTIONS="100"
    elif [ $TOTAL_RAM -lt 8192 ]; then
        # 4-8GB RAM
        INNODB_BUFFER="1G"
        MAX_CONNECTIONS="150"
    else
        # 8GB+ RAM
        INNODB_BUFFER="2G"
        MAX_CONNECTIONS="200"
    fi
    
    # Criar arquivo de configuração otimizado
    cat > /etc/mysql/mysql.conf.d/aluforce.cnf << EOF
# ============================================================================
# ALUFORCE - Configurações Otimizadas do MySQL
# Gerado automaticamente em $(date)
# RAM Total: ${TOTAL_RAM}MB
# ============================================================================

[mysqld]
# Performance
innodb_buffer_pool_size = ${INNODB_BUFFER}
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT

# Conexões
max_connections = ${MAX_CONNECTIONS}
max_connect_errors = 100000
wait_timeout = 600
interactive_timeout = 600

# Cache
query_cache_type = 0
query_cache_size = 0
table_open_cache = 4000
table_definition_cache = 2000

# Charset UTF8MB4
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# Logs
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2

# Segurança
local_infile = 0
symbolic-links = 0

# Timezone
default-time-zone = '-03:00'

[mysql]
default-character-set = utf8mb4

[client]
default-character-set = utf8mb4
EOF
    
    # Reiniciar MySQL para aplicar configurações
    systemctl restart mysql
    
    log_info "MySQL otimizado para ${TOTAL_RAM}MB de RAM"
    log_info "  - InnoDB Buffer Pool: ${INNODB_BUFFER}"
    log_info "  - Max Connections: ${MAX_CONNECTIONS}"
}

# Configurar firewall
configure_firewall() {
    log_step "Configurando firewall..."
    
    # Verificar se UFW está instalado
    if command -v ufw &> /dev/null; then
        # MySQL só aceita conexões locais por padrão (mais seguro)
        # Se precisar de acesso remoto, descomente a linha abaixo:
        # ufw allow 3306/tcp
        
        log_info "Firewall configurado (MySQL aceita apenas conexões locais)"
    else
        log_warn "UFW não instalado. Considere instalar: apt install ufw"
    fi
}

# Criar arquivo .env
create_env_file() {
    log_step "Criando arquivo de configuração..."
    
    ENV_FILE="/opt/aluforce/.env.database"
    mkdir -p /opt/aluforce
    
    cat > $ENV_FILE << EOF
# ============================================================================
# ALUFORCE - Configurações de Banco de Dados
# Gerado automaticamente em $(date)
# ============================================================================

# MySQL Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}

# Connection Pool
DB_CONNECTION_LIMIT=20
DB_QUEUE_LIMIT=0
EOF
    
    chmod 600 $ENV_FILE
    
    log_info "Arquivo de configuração salvo em: $ENV_FILE"
}

# Testar conexão
test_connection() {
    log_step "Testando conexão com o banco de dados..."
    
    if mysql -u${DB_USER} -p${DB_PASSWORD} -e "SELECT 1" ${DB_NAME} &> /dev/null; then
        log_info "Conexão testada com sucesso!"
    else
        log_error "Falha ao conectar ao banco de dados!"
        exit 1
    fi
}

# Exibir resumo final
show_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║           ✅ INSTALAÇÃO CONCLUÍDA COM SUCESSO!              ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  INFORMAÇÕES DE CONEXÃO${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${YELLOW}Host:${NC}     localhost"
    echo -e "  ${YELLOW}Porta:${NC}    3306"
    echo -e "  ${YELLOW}Database:${NC} ${DB_NAME}"
    echo -e "  ${YELLOW}Usuário:${NC}  ${DB_USER}"
    echo -e "  ${YELLOW}Senha:${NC}    ${DB_PASSWORD}"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  CONFIGURAÇÃO DO .ENV${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Adicione estas linhas ao seu arquivo .env:"
    echo ""
    echo -e "  ${GREEN}DB_HOST=localhost${NC}"
    echo -e "  ${GREEN}DB_PORT=3306${NC}"
    echo -e "  ${GREEN}DB_USER=${DB_USER}${NC}"
    echo -e "  ${GREEN}DB_PASSWORD=${DB_PASSWORD}${NC}"
    echo -e "  ${GREEN}DB_NAME=${DB_NAME}${NC}"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  COMANDOS ÚTEIS${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Acessar MySQL:        mysql -u${DB_USER} -p ${DB_NAME}"
    echo "  Status do MySQL:      systemctl status mysql"
    echo "  Reiniciar MySQL:      systemctl restart mysql"
    echo "  Ver logs:             tail -f /var/log/mysql/error.log"
    echo "  Importar backup:      mysql -u${DB_USER} -p ${DB_NAME} < backup.sql"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANTE: Guarde a senha em local seguro!${NC}"
    echo -e "${YELLOW}    Configurações salvas em: /opt/aluforce/.env.database${NC}"
    echo ""
}

# Salvar credenciais em arquivo temporário
save_credentials() {
    CRED_FILE="/root/mysql-credentials-aluforce.txt"
    
    cat > $CRED_FILE << EOF
============================================================================
ALUFORCE - Credenciais do MySQL
Gerado em: $(date)
============================================================================

Host:     localhost
Porta:    3306
Database: ${DB_NAME}
Usuário:  ${DB_USER}
Senha:    ${DB_PASSWORD}

============================================================================
CONFIGURAÇÃO DO .ENV
============================================================================

DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}

============================================================================
IMPORTANTE: Delete este arquivo após copiar as credenciais!
            rm $CRED_FILE
============================================================================
EOF
    
    chmod 600 $CRED_FILE
    log_info "Credenciais salvas em: $CRED_FILE"
}

# Função principal
main() {
    clear
    show_banner
    
    echo ""
    log_info "Iniciando instalação do MySQL para ALUFORCE..."
    echo ""
    
    check_root
    detect_os
    ask_password
    
    echo ""
    log_info "Iniciando instalação em 5 segundos..."
    log_info "Pressione Ctrl+C para cancelar"
    sleep 5
    
    update_system
    install_mysql
    secure_mysql
    create_database
    optimize_mysql
    configure_firewall
    create_env_file
    test_connection
    save_credentials
    show_summary
}

# Executar
main "$@"
