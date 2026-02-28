#!/bin/bash
# Atualiza o .env para usar MySQL local

ENV_FILE="/var/www/aluforce/.env"

# Backup
cp $ENV_FILE ${ENV_FILE}.backup-railway

# Atualizar configurações do banco
sed -i 's/DB_HOST=.*/DB_HOST=localhost/' $ENV_FILE
sed -i 's/DB_PORT=.*/DB_PORT=3306/' $ENV_FILE
sed -i 's/DB_USER=.*/DB_USER=aluforce/' $ENV_FILE
sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=Aluforce2026VpsDB/' $ENV_FILE
sed -i 's/DB_NAME=.*/DB_NAME=aluforce_vendas/' $ENV_FILE

echo "=== Configurações atualizadas ==="
grep "^DB_" $ENV_FILE

echo ""
echo "=== Reiniciando aplicação ==="
cd /var/www/aluforce && pm2 restart all

echo ""
echo "=== Status da aplicação ==="
pm2 status
