#!/bin/bash
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SHOW COLUMNS FROM usuarios LIKE '%pass%'"
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SHOW COLUMNS FROM usuarios LIKE '%senh%'"
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SHOW COLUMNS FROM usuarios" | head -30
