@echo off
chcp 65001 > nul
title Aluforce - Criador de Instalador Profissional v3.0

cd /d "%~dp0"

cls
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║                                                                          ║
echo ║         ███████╗██╗     ██╗   ██╗███████╗ ██████╗ ██████╗  ███████╗       ║
echo ║         ██╔══██║██║     ██║   ██║██╔════╝██╔═══██╗██╔══██╗ ██╔════╝       ║
echo ║         ███████║██║     ██║   ██║█████╗  ██║   ██║██████╔╝ █████╗         ║
echo ║         ██╔══██║██║     ██║   ██║██╔══╝  ██║   ██║██╔══██╗ ██╔══╝         ║
echo ║         ██║  ██║███████╗╚██████╔╝██║     ╚██████╔╝██║  ██║ ███████╗       ║
echo ║         ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚══════╝       ║
echo ║                                                                          ║
echo ║              CRIADOR DE INSTALADOR PROFISSIONAL v3.0                     ║
echo ║                     Sistema de Gestao Empresarial                        ║
echo ║                                                                          ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.

:: ============================================
:: VERIFICAÇÕES DE PRÉ-REQUISITOS
:: ============================================

echo [VERIFICANDO PRE-REQUISITOS]
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] Node.js nao encontrado!
    echo     Por favor, instale o Node.js: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER%

:: Verificar npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] npm nao encontrado!
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo [OK] npm v%NPM_VER%

:: Verificar icon.ico
if not exist "assets\icon.ico" (
    echo [X] Icone nao encontrado: assets\icon.ico
    echo     Por favor, adicione um icone .ico na pasta assets
    pause
    exit /b 1
)
echo [OK] Icone encontrado (assets\icon.ico)

:: Verificar LICENSE.txt
if not exist "LICENSE.txt" (
    echo [!] LICENSE.txt nao encontrado - criando arquivo padrao...
    (
        echo LICENCA DE USO - ALUFORCE SISTEMA
        echo ===================================
        echo.
        echo Copyright ^(c^) 2025 ALUFORCE
        echo Todos os direitos reservados.
        echo.
        echo Este software e propriedade da ALUFORCE e e fornecido "como esta",
        echo sem garantias de qualquer tipo, expressas ou implicitas.
        echo.
        echo O uso deste software esta sujeito aos termos e condicoes
        echo estabelecidos no contrato de licenca de usuario final.
    ) > LICENSE.txt
    echo [OK] LICENSE.txt criado
) else (
    echo [OK] LICENSE.txt encontrado
)

echo.

:: ============================================
:: INSTALAÇÃO DE DEPENDÊNCIAS
:: ============================================

echo [VERIFICANDO DEPENDENCIAS]
echo.

:: Verificar se node_modules existe
if not exist "node_modules" (
    echo Instalando dependencias do projeto...
    call npm install --legacy-peer-deps
    if %errorlevel% neq 0 (
        echo [X] Erro ao instalar dependencias!
        pause
        exit /b 1
    )
)
echo [OK] node_modules

:: Verificar se electron está instalado
if not exist "node_modules\electron" (
    echo Instalando Electron...
    set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    call npm install electron --save-dev --legacy-peer-deps
)
echo [OK] Electron

:: Verificar se electron-builder está instalado
if not exist "node_modules\electron-builder" (
    echo Instalando Electron Builder...
    call npm install electron-builder --save-dev --legacy-peer-deps
)
echo [OK] Electron Builder

echo.

:: ============================================
:: CRIAR ASSETS DO INSTALADOR
:: ============================================

echo [CRIANDO ASSETS DO INSTALADOR]
echo.

if exist "scripts\create-installer-assets.js" (
    echo Gerando imagens do instalador...
    call node scripts\create-installer-assets.js 2>nul
) else (
    echo [!] Script de assets nao encontrado - usando padrao
)

echo.

:: ============================================
:: MENU DE SELEÇÃO
:: ============================================

:MENU
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║                    SELECIONE O TIPO DE BUILD                             ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.
echo   [1] Instalador NSIS Completo (RECOMENDADO)
echo       - Cria atalho na Area de Trabalho e Menu Iniciar
echo       - Permite escolher pasta de instalacao
echo       - Desinstalador incluido
echo       - Executa o programa ao finalizar instalacao
echo.
echo   [2] Versao Portatil (.exe unico)
echo       - Nao precisa instalar
echo       - Ideal para testes ou uso em pendrives
echo.
echo   [3] Ambos (Instalador + Portatil)
echo       - Gera as duas versoes
echo.
echo   [0] Cancelar e Sair
echo.

set /p OPCAO=Digite sua opcao (0-3): 

if "%OPCAO%"=="0" (
    echo.
    echo Operacao cancelada pelo usuario.
    pause
    exit /b 0
)

if "%OPCAO%"=="1" goto BUILD_NSIS
if "%OPCAO%"=="2" goto BUILD_PORTABLE
if "%OPCAO%"=="3" goto BUILD_BOTH

echo Opcao invalida! Tente novamente.
echo.
goto MENU

:: ============================================
:: PROCESSO DE BUILD
:: ============================================

:BUILD_NSIS
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║         GERANDO INSTALADOR NSIS - AGUARDE...                             ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.
call npm run build:installer
goto CHECK_RESULT

:BUILD_PORTABLE
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║         GERANDO VERSAO PORTATIL - AGUARDE...                             ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.
call npm run build:portable
goto CHECK_RESULT

:BUILD_BOTH
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║         GERANDO INSTALADOR + PORTATIL - AGUARDE...                       ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.
call npm run build:win
goto CHECK_RESULT

:: ============================================
:: VERIFICAÇÃO DO RESULTADO
:: ============================================

:CHECK_RESULT
if %errorlevel% equ 0 goto SUCCESS
goto ERROR

:SUCCESS
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║                                                                          ║
echo ║               [OK] BUILD CONCLUIDO COM SUCESSO!                          ║
echo ║                                                                          ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.
echo   Os arquivos foram gerados em: dist-electron\
echo.
echo   Arquivos disponiveis:

:: Listar arquivos gerados
if exist "dist-electron\*.exe" (
    echo.
    for %%f in (dist-electron\*.exe) do (
        echo   [FILE] %%~nxf
    )
)

echo.
echo   PROXIMOS PASSOS:
echo   1. Navegue ate a pasta dist-electron
echo   2. Execute o instalador "Aluforce Sistema Setup x.x.x.exe"
echo   3. Siga o assistente de instalacao
echo   4. Um atalho sera criado na Area de Trabalho automaticamente
echo.

:: Abrir pasta de saída
echo Abrindo pasta de saida...
start "" explorer "%~dp0dist-electron"
goto END

:ERROR
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║                                                                          ║
echo ║                    [ERRO] FALHA AO CRIAR BUILD!                          ║
echo ║                                                                          ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.
echo   Possiveis solucoes:
echo.
echo   1. Verifique se existe um icone em assets\icon.ico
echo   2. Tente: npm cache clean --force
echo   3. Tente: rmdir /s /q node_modules ^&^& npm install
echo   4. Verifique os logs de erro acima
echo.
echo   Se o problema persistir, entre em contato com o suporte.
echo.
goto END

:END
echo.
pause
