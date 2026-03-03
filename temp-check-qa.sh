#!/bin/bash
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SELECT id, nome, email, senha, ativo, role FROM usuarios WHERE id=57"
