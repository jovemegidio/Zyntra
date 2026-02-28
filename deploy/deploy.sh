#!/bin/bash
# ============================================================
# ALUFORCE - Deploy Rápido
# Execute após enviar os arquivos: bash deploy.sh
# ============================================================

APP_DIR="/var/www/aluforce"

echo "🚀 Iniciando deploy ALUFORCE..."

cd $APP_DIR

# Instalar/atualizar dependências
echo "📦 Instalando dependências..."
npm install --production

# Reiniciar aplicação
echo "🔄 Reiniciando aplicação..."
pm2 restart aluforce 2>/dev/null || pm2 start server.js --name aluforce

# Salvar configuração PM2
pm2 save

echo ""
echo "✅ Deploy concluído!"
echo "📊 Status: pm2 status"
echo "📋 Logs: pm2 logs aluforce"
