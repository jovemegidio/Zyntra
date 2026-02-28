@echo off
title ALUFORCE - Modo Turbo
color 0B

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║          ALUFORCE v2.0 - MODO TURBO                      ║
echo ║          Inicializacao Ultra Rapida                       ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Verificar Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERRO] Node.js nao encontrado!
    pause
    exit /b 1
)

:: Configuracoes de performance
set NODE_ENV=production
set UV_THREADPOOL_SIZE=8
set NODE_OPTIONS=--max-old-space-size=512

echo [*] Limpando cache temporario...
if exist logs\*.log del /q logs\*.log >nul 2>nul

echo [*] Iniciando servidor otimizado...
echo.

:: Usar servidor otimizado se existir
if exist server-otimizado.js (
    node server-otimizado.js
) else (
    node server.js
)

pause
