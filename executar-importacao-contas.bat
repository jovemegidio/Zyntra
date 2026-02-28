@echo off
echo ========================================
echo   IMPORTACAO DE CONTAS BANCARIAS
echo ========================================
echo.
cd /d "c:\Users\egidio\Music\Sistema - ALUFORCE - V.2"
node importar-contas-manual.js
echo.
echo ========================================
echo.
echo Verificando dados importados...
node verificar-contas.js
echo.
pause
