@echo off
REM Script para criar as tabelas do módulo Financeiro no MySQL

echo ========================================
echo Criando tabelas do módulo Financeiro
echo ========================================

REM Caminho para o MySQL
set MYSQL_PATH="C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"

REM Verificar se o MySQL existe
if not exist %MYSQL_PATH% (
    echo ERRO: MySQL não encontrado em %MYSQL_PATH%
    echo Por favor, ajuste o caminho do MySQL no script.
    pause
    exit /b 1
)

REM Executar o script SQL
%MYSQL_PATH% -u root -p aluforce_vendas < "database\create_tables_financeiro.sql"

echo.
echo ========================================
echo Tabelas criadas com sucesso!
echo ========================================
echo.

pause
