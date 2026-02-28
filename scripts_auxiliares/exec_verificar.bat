@echo off
cd /d "C:\Users\Administrator\Desktop\Sistema - ALUFORCE - V.2"
node verificar_estrutura.js > verificar_saida.txt 2>&1
type verificar_saida.txt
pause
