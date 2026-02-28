#!/bin/bash
mysql -u aluforce -p'Aluforce2026VpsDB' aluforce_vendas -e "
SELECT id, nome, email FROM usuarios WHERE email LIKE '%hellen%' OR email LIKE '%financeiro%' OR nome LIKE '%Hellen%' ORDER BY id;
"