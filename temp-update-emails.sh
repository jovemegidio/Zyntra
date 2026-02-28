#!/bin/bash
mysql -u aluforce -p'Aluforce2026VpsDB' aluforce_vendas << 'EOSQL'

-- Update Hellen (id=18)
UPDATE usuarios SET email = 'financeiro2@aluforce.ind.br' WHERE id = 18;

-- Update Tatiane (id=55)
UPDATE usuarios SET email = 'financeiro3@aluforce.ind.br' WHERE id = 55;

-- Update Junior (id=11)
UPDATE usuarios SET email = 'adm@aluforce.ind.br' WHERE id = 11;

-- Also update funcionarios table if they exist there
UPDATE funcionarios SET email = 'financeiro2@aluforce.ind.br' WHERE email = 'hellen.nascimento@aluforce.ind.br';
UPDATE funcionarios SET email = 'financeiro3@aluforce.ind.br' WHERE email = 'tatiane.sousa@aluforce.ind.br';
UPDATE funcionarios SET email = 'adm@aluforce.ind.br' WHERE email = 'junior@aluforce.ind.br';

-- Verify
SELECT id, nome, email FROM usuarios WHERE id IN (11, 18, 55) ORDER BY id;

EOSQL