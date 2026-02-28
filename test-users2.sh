#!/bin/bash
echo "=== User columns ==="
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SHOW COLUMNS FROM usuarios LIKE '%senh%'"
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SHOW COLUMNS FROM usuarios LIKE '%pass%'"

echo "=== Users ==="
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SELECT id, nome, email, LEFT(COALESCE(password_hash, senha_hash, ''), 10) as pw_preview, status FROM usuarios WHERE email LIKE '%@aluforce%' LIMIT 10"
