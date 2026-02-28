@echo off
REM ========================================
REM BACKUP DO BANCO DE DADOS - ALUFORCE v2.0
REM ========================================
REM Este script faz backup do banco MySQL/MariaDB
REM usando mysqldump diretamente
REM ========================================

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   BACKUP ALUFORCE v2.0
echo ========================================
echo.

REM Carrega configurações do .env
for /f "tokens=1,2 delims==" %%a in (.env) do (
    set "%%a=%%b"
)

REM Define variáveis
set "BACKUP_DIR=%~dp0backups"
set "TIMESTAMP=%date:~6,4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"
set "BACKUP_FILE=%BACKUP_DIR%\backup_aluforce_%TIMESTAMP%.sql"

REM Criar diretório de backup se não existir
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo [INFO] Host: %DB_HOST%:%DB_PORT%
echo [INFO] Banco: %DB_NAME%
echo [INFO] Arquivo: %BACKUP_FILE%
echo.

REM Procurar mysqldump
set "MYSQLDUMP="
if exist "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" (
    set "MYSQLDUMP=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
) else if exist "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe" (
    set "MYSQLDUMP=C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe"
) else if exist "C:\Program Files\MySQL\MySQL Server 5.7\bin\mysqldump.exe" (
    set "MYSQLDUMP=C:\Program Files\MySQL\MySQL Server 5.7\bin\mysqldump.exe"
) else if exist "C:\xampp\mysql\bin\mysqldump.exe" (
    set "MYSQLDUMP=C:\xampp\mysql\bin\mysqldump.exe"
) else if exist "C:\laragon\bin\mysql\mysql-8.0.30-winx64\bin\mysqldump.exe" (
    set "MYSQLDUMP=C:\laragon\bin\mysql\mysql-8.0.30-winx64\bin\mysqldump.exe"
) else (
    REM Tentar usar do PATH
    where mysqldump >nul 2>&1
    if !errorlevel! equ 0 (
        set "MYSQLDUMP=mysqldump"
    )
)

if "%MYSQLDUMP%"=="" (
    echo [ERRO] mysqldump nao encontrado!
    echo.
    echo Possiveis solucoes:
    echo   1. Instale o MySQL Client
    echo   2. Adicione o MySQL ao PATH do sistema
    echo   3. Instale o XAMPP ou Laragon
    echo.
    pause
    exit /b 1
)

echo [INFO] Usando: %MYSQLDUMP%
echo [INFO] Iniciando backup...
echo.

REM Executar backup
"%MYSQLDUMP%" -h%DB_HOST% -P%DB_PORT% -u%DB_USER% --password=%DB_PASSWORD% --single-transaction --routines --triggers --events --add-drop-table --complete-insert --default-character-set=utf8mb4 %DB_NAME% > "%BACKUP_FILE%"

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao executar backup!
    echo Verifique as credenciais do banco no arquivo .env
    pause
    exit /b 1
)

REM Verificar tamanho do arquivo
for %%A in ("%BACKUP_FILE%") do set "FILESIZE=%%~zA"

if %FILESIZE% lss 1000 (
    echo [ERRO] Arquivo de backup muito pequeno, pode estar vazio!
    del "%BACKUP_FILE%" 2>nul
    pause
    exit /b 1
)

echo.
echo ========================================
echo   BACKUP CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo Arquivo: %BACKUP_FILE%
echo Tamanho: %FILESIZE% bytes
echo.

REM Perguntar se quer compactar
set /p COMPACTAR="Deseja compactar o backup? (S/N): "
if /i "%COMPACTAR%"=="S" (
    echo [INFO] Para compactar, use 7-Zip ou WinRAR manualmente
    echo        ou instale gzip para Windows
)

echo.
echo Pressione qualquer tecla para sair...
pause >nul
