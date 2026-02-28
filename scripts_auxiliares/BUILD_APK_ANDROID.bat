@echo off
chcp 65001 >nul
cls
title ALUFORCE - BUILD APK ANDROID

echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║                   🚀 ALUFORCE - BUILD APK ANDROID                         ║
echo ║               Sistema de Gestão Empresarial - Mobile                      ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.

:: Verifica Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js não encontrado! Instale em: https://nodejs.org
    pause
    exit /b 1
)

:: Verifica Java
where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Java não encontrado! Instale o JDK 17+
    pause
    exit /b 1
)

echo [INFO] Dependências encontradas ✓
echo.

:: Menu de opções
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║                        ESCOLHA O MODO DE BUILD                            ║
echo ╠══════════════════════════════════════════════════════════════════════════╣
echo ║  [1] Build DEBUG    - APK para testes (instalação direta)                ║
echo ║  [2] Build RELEASE  - APK assinado para produção                         ║
echo ║  [3] Sincronizar    - Atualizar arquivos web no Android                  ║
echo ║  [4] Abrir Studio   - Abrir projeto no Android Studio                    ║
echo ║  [5] Limpar Build   - Limpar cache e builds anteriores                   ║
echo ║  [0] Sair                                                                 ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.

set /p opcao="Digite a opção: "

if "%opcao%"=="1" goto BUILD_DEBUG
if "%opcao%"=="2" goto BUILD_RELEASE
if "%opcao%"=="3" goto SYNC
if "%opcao%"=="4" goto OPEN_STUDIO
if "%opcao%"=="5" goto CLEAN
if "%opcao%"=="0" exit /b 0
goto :eof

:BUILD_DEBUG
echo.
echo ════════════════════════════════════════════════════════════════════════════
echo [1/4] Instalando dependências npm...
call npm install --silent 2>nul

echo [2/4] Sincronizando arquivos web com Android...
call npx cap sync android

echo [3/4] Gerando APK Debug...
cd android
call gradlew.bat assembleDebug
cd ..

if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    echo.
    echo ╔══════════════════════════════════════════════════════════════════════════╗
    echo ║  ✅ APK DEBUG GERADO COM SUCESSO!                                        ║
    echo ╠══════════════════════════════════════════════════════════════════════════╣
    echo ║  Localização: android\app\build\outputs\apk\debug\app-debug.apk          ║
    echo ╚══════════════════════════════════════════════════════════════════════════╝
    
    :: Copiar para pasta de fácil acesso
    if not exist "APK-OUTPUT" mkdir APK-OUTPUT
    copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "APK-OUTPUT\ALUFORCE-DEBUG.apk" >nul
    echo.
    echo [INFO] APK também copiado para: APK-OUTPUT\ALUFORCE-DEBUG.apk
    
    echo.
    set /p install="Deseja instalar no dispositivo conectado? (S/N): "
    if /i "%install%"=="S" (
        adb install -r "APK-OUTPUT\ALUFORCE-DEBUG.apk"
    )
) else (
    echo [ERRO] Falha ao gerar APK. Verifique os logs acima.
)
pause
goto :eof

:BUILD_RELEASE
echo.
echo ════════════════════════════════════════════════════════════════════════════
echo [INFO] Para build de produção, você precisa de uma keystore assinada.
echo.

:: Verifica se existe keystore
if not exist "android\app\aluforce-release.keystore" (
    echo [INFO] Keystore não encontrada. Criando uma nova...
    echo.
    set /p criar="Deseja criar uma nova keystore? (S/N): "
    if /i "%criar%"=="S" (
        call :CRIAR_KEYSTORE
    ) else (
        echo [INFO] Para criar manualmente, execute:
        echo keytool -genkeypair -v -keystore aluforce-release.keystore -alias aluforce -keyalg RSA -keysize 2048 -validity 10000
        pause
        goto :eof
    )
)

echo [1/4] Instalando dependências...
call npm install --silent 2>nul

echo [2/4] Sincronizando arquivos web...
call npx cap sync android

echo [3/4] Gerando APK Release...
cd android
call gradlew.bat assembleRelease
cd ..

if exist "android\app\build\outputs\apk\release\app-release-unsigned.apk" (
    echo.
    echo ╔══════════════════════════════════════════════════════════════════════════╗
    echo ║  ✅ APK RELEASE GERADO!                                                  ║
    echo ╠══════════════════════════════════════════════════════════════════════════╣
    echo ║  Nota: APK está não-assinado. Configure o signing no gradle.             ║
    echo ╚══════════════════════════════════════════════════════════════════════════╝
    
    if not exist "APK-OUTPUT" mkdir APK-OUTPUT
    copy /Y "android\app\build\outputs\apk\release\*.apk" "APK-OUTPUT\" >nul
)
pause
goto :eof

:SYNC
echo.
echo [INFO] Sincronizando arquivos web com projeto Android...
call npx cap sync android
echo.
echo ✅ Sincronização concluída!
pause
goto :eof

:OPEN_STUDIO
echo.
echo [INFO] Abrindo Android Studio...
set ANDROID_STUDIO="C:\Program Files\Android\Android Studio\bin\studio64.exe"
if exist %ANDROID_STUDIO% (
    start "" %ANDROID_STUDIO% "%cd%\android"
    echo ✅ Android Studio aberto!
) else (
    echo [INFO] Tentando localizar Android Studio...
    for /d %%i in ("C:\Program Files\Android\*") do (
        if exist "%%i\bin\studio64.exe" (
            start "" "%%i\bin\studio64.exe" "%cd%\android"
            echo ✅ Android Studio aberto!
            goto :studio_found
        )
    )
    echo [ERRO] Android Studio não encontrado automaticamente.
    echo [INFO] Abra manualmente e importe a pasta: %cd%\android
)
:studio_found
pause
goto :eof

:CLEAN
echo.
echo [INFO] Limpando builds anteriores...
cd android
call gradlew.bat clean
cd ..
if exist "APK-OUTPUT" rmdir /s /q "APK-OUTPUT"
echo ✅ Limpeza concluída!
pause
goto :eof

:CRIAR_KEYSTORE
echo.
echo ════════════════════════════════════════════════════════════════════════════
echo [INFO] Criando keystore de release...
echo.
set /p ALIAS="Nome do alias (ex: aluforce): "
set /p NOME="Seu nome completo: "
set /p ORG="Nome da organização: "
set /p CIDADE="Cidade: "
set /p ESTADO="Estado (sigla): "
set /p PAIS="País (BR): "

keytool -genkeypair -v -keystore "android\app\aluforce-release.keystore" -alias %ALIAS% -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=%NOME%, O=%ORG%, L=%CIDADE%, ST=%ESTADO%, C=%PAIS%"

if exist "android\app\aluforce-release.keystore" (
    echo.
    echo ✅ Keystore criada com sucesso!
) else (
    echo [ERRO] Falha ao criar keystore.
)
goto :eof
