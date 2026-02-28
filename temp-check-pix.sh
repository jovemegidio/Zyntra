#!/bin/bash
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -N -e "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='funcionarios' AND COLUMN_NAME IN ('banco','agencia','conta_corrente','tipo_chave_pix','chave_pix','tipo_conta') ORDER BY ORDINAL_POSITION;"
