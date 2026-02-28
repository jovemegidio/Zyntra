#!/bin/bash
mysql -u aluforce -p'Aluforce2026VpsDB' aluforce_vendas << 'EOSQL'

-- Check current emails
SELECT id, nome, email FROM usuarios WHERE nome LIKE '%Hellen%' OR nome LIKE '%Tatiane%' OR email = 'junior@aluforce.ind.br' OR email = 'adm@aluforce.ind.br';

EOSQL