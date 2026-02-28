@echo off
echo ========================================
echo  LIMPAR CACHE DO CHAT ALUFORCE
echo ========================================
echo.
echo Este script vai:
echo 1. Parar servidor Node.js (se rodando)
echo 2. Limpar cache de builds
echo 3. Reiniciar servidor
echo.

taskkill /F /IM node.exe 2>nul
if %errorlevel% == 0 (
    echo [OK] Servidor Node.js parado
) else (
    echo [OK] Nenhum servidor Node.js rodando
)

echo.
echo ========================================
echo  INSTRUCOES PARA O NAVEGADOR
echo ========================================
echo.
echo Agora faca o seguinte no navegador:
echo.
echo 1. Pressione: Ctrl + Shift + Delete
echo 2. Selecione: "Todo o periodo"
echo 3. Marque: "Imagens e arquivos em cache"
echo 4. Clique em: "Limpar dados"
echo.
echo OU simplesmente:
echo - Pressione: Ctrl + F5 (hard refresh)
echo.
echo ========================================
echo  PRONTO!
echo ========================================
echo.
echo Agora atualize a pagina e o chat
echo aparecera LIMPO, sem menus antigos!
echo.
pause
