#!/bin/bash
# Criar usuário e configurar banco

mysql << 'MYSQL_SCRIPT'
CREATE USER IF NOT EXISTS 'aluforce'@'localhost' IDENTIFIED BY 'Aluforce2026VpsDB';
GRANT ALL PRIVILEGES ON aluforce_vendas.* TO 'aluforce'@'localhost';
FLUSH PRIVILEGES;
SELECT User, Host FROM mysql.user WHERE User='aluforce';
MYSQL_SCRIPT

echo "Testando conexão..."
mysql -ualuforce -pAluforce2026VpsDB -e "SELECT 'Conexao OK!' as Status" aluforce_vendas
