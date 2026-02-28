@echo off
chcp 65001 >nul
cls

echo ╔══════════════════════════════════════════════════════════════════╗
echo ║     ALUFORCE - Configurar Inicialização Automática               ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.

:: Cria atalho na pasta Startup do Windows
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SCRIPT=C:\Users\egidio\Music\Sistema - ALUFORCE - V.2\SERVIDOR_ALUFORCE.bat"
set "SHORTCUT=%STARTUP%\ALUFORCE Server.lnk"

:: Remove atalho antigo se existir
if exist "%SHORTCUT%" del "%SHORTCUT%"

:: Cria novo atalho usando PowerShell
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%SCRIPT%'; $s.WorkingDirectory = 'C:\Users\egidio\Music\Sistema - ALUFORCE - V.2'; $s.WindowStyle = 7; $s.Description = 'ALUFORCE Server'; $s.Save()"

if exist "%SHORTCUT%" (
    echo [OK] Servidor configurado para iniciar com o Windows!
    echo.
    echo     Localização: %SHORTCUT%
    echo.
    echo     O servidor iniciará automaticamente quando o Windows ligar.
) else (
    echo [ERRO] Não foi possível criar o atalho.
)

echo.
pause
