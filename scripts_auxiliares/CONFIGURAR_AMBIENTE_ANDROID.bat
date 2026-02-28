@echo off
chcp 65001 >nul
cls
title ALUFORCE - Configuração do Ambiente Android

echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║          📱 ALUFORCE - CONFIGURAÇÃO DO AMBIENTE ANDROID                  ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.

:: Detecta Java
echo [INFO] Detectando Java...
set "JAVA_PATHS=C:\Program Files\Java;C:\Program Files\Eclipse Adoptium;C:\Program Files\Microsoft;C:\Program Files\Amazon Corretto"

for %%P in (%JAVA_PATHS%) do (
    for /d %%J in ("%%P\jdk*") do (
        if exist "%%J\bin\java.exe" (
            echo [OK] Java encontrado: %%J
            set "JAVA_HOME=%%J"
            goto :java_found
        )
    )
)

:: Tenta encontrar com where
for /f "tokens=*" %%i in ('where java 2^>nul') do (
    set "JAVA_PATH=%%~dpi"
    set "JAVA_HOME=%%~dpi.."
    echo [OK] Java encontrado via PATH: %JAVA_HOME%
    goto :java_found
)

echo [ERRO] Java não encontrado! 
echo        Instale o JDK 17+ de: https://adoptium.net
goto :error

:java_found

:: Detecta Android SDK
echo.
echo [INFO] Detectando Android SDK...
set "SDK_PATHS=%LOCALAPPDATA%\Android\Sdk;%USERPROFILE%\AppData\Local\Android\Sdk;C:\Android\Sdk;%ANDROID_HOME%"

for %%S in (%SDK_PATHS%) do (
    if exist "%%S\platform-tools\adb.exe" (
        echo [OK] Android SDK encontrado: %%S
        set "ANDROID_HOME=%%S"
        set "ANDROID_SDK_ROOT=%%S"
        goto :sdk_found
    )
)

echo [AVISO] Android SDK não encontrado automaticamente.
echo         Verifique se o Android Studio está instalado.
echo.
set /p SDK_PATH="Digite o caminho do SDK (ou Enter para pular): "
if not "%SDK_PATH%"=="" (
    set "ANDROID_HOME=%SDK_PATH%"
    set "ANDROID_SDK_ROOT=%SDK_PATH%"
)

:sdk_found

:: Cria arquivo local.properties
echo.
echo [INFO] Criando local.properties...
set "LOCAL_PROPS=android\local.properties"
echo sdk.dir=%ANDROID_HOME:\=\\% > "%LOCAL_PROPS%"
echo [OK] local.properties criado

:: Exporta variáveis para a sessão atual
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\tools;%PATH%"

echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║  ✅ AMBIENTE CONFIGURADO!                                                ║
echo ╠══════════════════════════════════════════════════════════════════════════╣
echo ║  JAVA_HOME: %JAVA_HOME%
echo ║  ANDROID_HOME: %ANDROID_HOME%
echo ╚══════════════════════════════════════════════════════════════════════════╝
echo.

:: Verifica versão do Java
echo [INFO] Verificando versão do Java...
"%JAVA_HOME%\bin\java" -version 2>&1 | findstr /i "version"
echo.

:: Pergunta se quer fazer o build
set /p BUILD="Deseja fazer o build do APK agora? (S/N): "
if /i "%BUILD%"=="S" (
    call BUILD_APK_ANDROID.bat
)

goto :end

:error
echo.
echo ╔══════════════════════════════════════════════════════════════════════════╗
echo ║  ❌ CONFIGURAÇÃO INCOMPLETA                                              ║
echo ║  Instale as dependências faltantes e execute novamente.                  ║
echo ╚══════════════════════════════════════════════════════════════════════════╝
pause
exit /b 1

:end
pause
