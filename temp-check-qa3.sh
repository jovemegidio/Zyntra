#!/bin/bash
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SELECT id, nome, email, password_hash, senha_hash, ativo, role, forcar_troca_senha, must_reset_password, senha_temporaria FROM usuarios WHERE id=57"
