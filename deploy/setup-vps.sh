#!/bin/bash
# ============================================================
# ALUFORCE v2.0 - Script de Instalação VPS
# Execute como root: bash setup-vps.sh
# ============================================================

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         ALUFORCE v2.0 - Instalação Automática VPS         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Variáveis (edite conforme necessário)
APP_NAME="aluforce"
APP_DIR="/var/www/$APP_NAME"
DOMAIN=""  # Deixe vazio se não tiver domínio ainda
PORT=3000

# ============================================================
# 1. ATUALIZAR SISTEMA
# ============================================================
echo -e "${GREEN}[1/8] Atualizando sistema...${NC}"
apt update && apt upgrade -y

# ============================================================
# 2. INSTALAR NODE.JS 20 LTS
# ============================================================
echo -e "${GREEN}[2/8] Instalando Node.js 20 LTS...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo "Node.js versão: $(node -v)"
echo "NPM versão: $(npm -v)"

# ============================================================
# 3. INSTALAR PM2 (Gerenciador de Processos)
# ============================================================
echo -e "${GREEN}[3/8] Instalando PM2...${NC}"
npm install -g pm2

# ============================================================
# 4. INSTALAR NGINX
# ============================================================
echo -e "${GREEN}[4/8] Instalando Nginx...${NC}"
apt install -y nginx
systemctl enable nginx
systemctl start nginx

# ============================================================
# 5. INSTALAR GIT
# ============================================================
echo -e "${GREEN}[5/8] Instalando Git...${NC}"
apt install -y git

# ============================================================
# 6. CRIAR DIRETÓRIO DA APLICAÇÃO
# ============================================================
echo -e "${GREEN}[6/8] Criando diretório da aplicação...${NC}"
mkdir -p $APP_DIR
chown -R $USER:$USER $APP_DIR

# ============================================================
# 7. CONFIGURAR NGINX
# ============================================================
echo -e "${GREEN}[7/8] Configurando Nginx...${NC}"

cat > /etc/nginx/sites-available/$APP_NAME << 'NGINX_CONFIG'
server {
    listen 80;
    server_name _;  # Aceita qualquer domínio/IP

    # Tamanho máximo de upload (100MB)
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # WebSocket support
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_CONFIG

# Ativar site
ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Testar e reiniciar Nginx
nginx -t
systemctl restart nginx

# ============================================================
# 8. CONFIGURAR FIREWALL
# ============================================================
echo -e "${GREEN}[8/8] Configurando Firewall...${NC}"
apt install -y ufw
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable

# ============================================================
# FINALIZAÇÃO
# ============================================================
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              ✅ INSTALAÇÃO CONCLUÍDA!                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}PRÓXIMOS PASSOS:${NC}"
echo ""
echo "1. Envie seu código para o servidor:"
echo "   cd $APP_DIR"
echo "   git clone https://github.com/SEU-USUARIO/aluforce.git ."
echo ""
echo "   OU use FileZilla/SCP para enviar os arquivos"
echo ""
echo "2. Configure o arquivo .env:"
echo "   nano $APP_DIR/.env"
echo ""
echo "3. Instale as dependências:"
echo "   cd $APP_DIR && npm install"
echo ""
echo "4. Inicie a aplicação:"
echo "   pm2 start server.js --name aluforce"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "5. Acesse pelo IP do servidor:"
echo "   http://$(curl -s ifconfig.me)"
echo ""
echo "============================================================"
