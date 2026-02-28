@echo off
cd /d "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2"
echo Executando importacao de dados bancarios...
node importar-bancos-excel.js
echo.
echo Pressione qualquer tecla para sair...
pause > nul
