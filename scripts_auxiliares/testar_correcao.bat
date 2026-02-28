@echo off
echo ========================================
echo REINICIANDO SERVIDOR E GERANDO TESTE
echo ========================================

cd /d "C:\Users\Administrator\Desktop\Sistema - ALUFORCE - V.2"

:: Parar processos node antigos na porta 3000
echo Parando processos antigos...
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)

timeout /t 2 /nobreak >nul

:: Iniciar servidor em background
echo Iniciando servidor...
start /B node server.js > server_output.log 2>&1

echo Aguardando servidor iniciar...
timeout /t 5 /nobreak >nul

:: Testar geração de ordem
echo.
echo ========================================
echo GERANDO ORDEM DE TESTE
echo ========================================

curl -X POST http://localhost:3000/api/gerar-ordem-excel ^
  -H "Content-Type: application/json" ^
  -d "{\"numero_orcamento\":\"OP_CORRECAO_TESTE\",\"numero_pedido\":\"PED-2025-001\",\"data_liberacao\":\"25/01/2025\",\"vendedor\":\"Carlos Silva\",\"prazo_entrega\":\"15 dias uteis\",\"cliente\":\"Empresa Teste Ltda\",\"contato_cliente\":\"Joao da Silva\",\"fone_cliente\":\"(11) 99999-8888\",\"email_cliente\":\"joao@empresateste.com.br\",\"tipo_frete\":\"CIF\",\"transportadora_nome\":\"Trans Express\",\"transportadora_fone\":\"(11) 3333-4444\",\"transportadora_cep\":\"01310-100\",\"transportadora_endereco\":\"Av Paulista 1000\",\"transportadora_cpf_cnpj\":\"12345678000199\",\"transportadora_email_nfe\":\"nfe@transexpress.com.br\",\"produtos\":[{\"codigo\":\"DUN16\",\"descricao\":\"ALUFORCE CB DUPLEX 16mm\",\"embalagem\":\"Bobina\",\"lances\":\"500m\",\"quantidade\":100,\"valor_unitario\":15.50},{\"codigo\":\"TRN50\",\"descricao\":\"ALUFORCE CB TRIPLEX 50mm\",\"embalagem\":\"Bobina\",\"lances\":\"300m\",\"quantidade\":50,\"valor_unitario\":32.75},{\"codigo\":\"DUI25\",\"descricao\":\"ALUFORCE CB DUPLEX 25mm ISO\",\"embalagem\":\"Bobina\",\"lances\":\"400m\",\"quantidade\":75,\"valor_unitario\":22.00},{\"codigo\":\"TRI10\",\"descricao\":\"ALUFORCE CB TRIPLEX 10mm ISO\",\"embalagem\":\"Bobina\",\"lances\":\"250m\",\"quantidade\":30,\"valor_unitario\":18.50},{\"codigo\":\"DUN35\",\"descricao\":\"ALUFORCE CB DUPLEX 35mm\",\"embalagem\":\"Bobina\",\"lances\":\"600m\",\"quantidade\":45,\"valor_unitario\":28.90}]}" ^
  -o OP_CORRECAO_TESTE_TEMP.xlsx 2>&1

if exist OP_CORRECAO_TESTE_TEMP.xlsx (
    move OP_CORRECAO_TESTE_TEMP.xlsx "ordens-emitidas\OP_CORRECAO_TESTE.xlsx" >nul
    echo.
    echo ========================================
    echo ORDEM GERADA COM SUCESSO!
    echo Arquivo: ordens-emitidas\OP_CORRECAO_TESTE.xlsx
    echo ========================================
) else (
    echo.
    echo ERRO: Nao foi possivel gerar a ordem!
    echo Verificando logs...
    type server_output.log | findstr /i "erro error"
)

echo.
pause
