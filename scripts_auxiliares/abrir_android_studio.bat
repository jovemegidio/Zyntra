@echo off
chcp 65001 >nul
cls

echo ╔══════════════════════════════════════════════════════════════════╗
echo ║                ALUFORCE - ABRIR ANDROID STUDIO                   ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.

set ANDROID_STUDIO="C:\Program Files\Android\Android Studio\bin\studio64.exe"

if exist %ANDROID_STUDIO% (
    echo [INFO] Abrindo projeto Android no Android Studio...
    start "" %ANDROID_STUDIO% "C:\Users\egidio\Music\Sistema - ALUFORCE - V.2\android"
    echo [OK] Android Studio aberto com sucesso!
) else (
    echo [ERRO] Android Studio nao encontrado em:
    echo        %ANDROID_STUDIO%
    echo.
    echo [INFO] Por favor, abra o Android Studio manualmente e importe a pasta:
    echo        C:\Users\egidio\Music\Sistema - ALUFORCE - V.2\android
)

echo.
echo ╔══════════════════════════════════════════════════════════════════╗
echo ║  PROXIMOS PASSOS:                                                ║
echo ╠══════════════════════════════════════════════════════════════════╣
echo ║  1. Aguarde o Gradle sincronizar o projeto                       ║
echo ║  2. Execute INICIAR_SERVIDOR_APP.bat antes de testar             ║
echo ║  3. Build ^> Build Bundle(s) / APK(s) ^> Build APK(s)             ║
echo ║  4. O APK estara em: android\app\build\outputs\apk\debug         ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.
pause
