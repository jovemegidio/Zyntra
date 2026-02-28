@echo off
chcp 65001 >nul
cd /d "C:\Users\Administrator\Desktop\Sistema - ALUFORCE - V.2"

echo ========================================
echo   TESTE DE GERACAO DE ORDEM (Nome Arquivo)
echo ========================================
echo.

:: Verificar se servidor está rodando
curl -s http://localhost:3000/api/status >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Servidor nao detectado na porta 3000
    echo Iniciando servidor...
    start /B node server.js
    timeout /t 5 /nobreak >nul
)

echo Gerando ordem de teste...
echo.

curl -X POST http://localhost:3000/api/gerar-ordem-excel ^
  -H "Content-Type: application/json" ^
  -d "{\"numero_orcamento\":\"ORC-TESTE-2025\",\"numero_pedido\":\"PED-TESTE-2025\",\"data_liberacao\":\"25/12/2025\",\"vendedor\":\"Carlos Silva\",\"prazo_entrega\":\"15 dias uteis\",\"cliente\":\"ACME Industria e Comercio Ltda\",\"contato_cliente\":\"Joao da Silva\",\"fone_cliente\":\"(11) 99999-8888\",\"email_cliente\":\"joao@acme.com.br\",\"tipo_frete\":\"CIF\",\"transportadora_nome\":\"Trans Express\",\"transportadora_fone\":\"(11) 3333-4444\",\"transportadora_cep\":\"01310-100\",\"transportadora_endereco\":\"Av Paulista 1000\",\"transportadora_cpf_cnpj\":\"12345678000199\",\"transportadora_email_nfe\":\"nfe@transexpress.com.br\",\"produtos\":[{\"codigo\":\"DUN16\",\"descricao\":\"ALUFORCE CB DUPLEX 16mm\",\"embalagem\":\"Bobina\",\"lances\":\"500m\",\"quantidade\":100,\"valor_unitario\":15.50},{\"codigo\":\"TRN50\",\"descricao\":\"ALUFORCE CB TRIPLEX 50mm\",\"embalagem\":\"Bobina\",\"lances\":\"300m\",\"quantidade\":50,\"valor_unitario\":32.75}]}" ^
  -o "ordens-emitidas\Ordem de Producao - ACME Industria e Comercio Ltda - ERP.xlsx" ^
  -w "\nStatus HTTP: %%{http_code}\nTamanho: %%{size_download} bytes\n"

echo.
echo ========================================
echo   VERIFICANDO ARQUIVO GERADO
echo ========================================
echo.

if exist "ordens-emitidas\Ordem de Producao - ACME Industria e Comercio Ltda - ERP.xlsx" (
    echo [OK] Arquivo gerado com sucesso!
    echo.
    dir "ordens-emitidas\Ordem de Producao - ACME Industria e Comercio Ltda - ERP.xlsx"
    echo.
    echo Para abrir o arquivo, execute:
    echo start "" "ordens-emitidas\Ordem de Producao - ACME Industria e Comercio Ltda - ERP.xlsx"
) else (
    echo [ERRO] Arquivo nao foi gerado!
    echo Verifique se o servidor esta rodando: node server.js
)

echo.
pause
