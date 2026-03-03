#!/bin/bash
mysql -u aluforce -p'Aluforce2026VpsDB' aluforce_vendas <<'EOF'
ALTER TABLE chat_mensagens_canal ADD COLUMN arquivo_url VARCHAR(500) DEFAULT NULL, ADD COLUMN arquivo_nome VARCHAR(255) DEFAULT NULL, ADD COLUMN arquivo_tamanho BIGINT DEFAULT NULL;
EOF
echo "canal: $?"

mysql -u aluforce -p'Aluforce2026VpsDB' aluforce_vendas <<'EOF'
ALTER TABLE chat_mensagens_diretas ADD COLUMN arquivo_url VARCHAR(500) DEFAULT NULL, ADD COLUMN arquivo_nome VARCHAR(255) DEFAULT NULL, ADD COLUMN arquivo_tamanho BIGINT DEFAULT NULL;
EOF
echo "diretas: $?"
