@echo off
echo === LIMPEZA DE ARQUIVOS DE TESTE E TEMPORARIOS ===
echo.

cd /d "c:\Users\Administrator\Desktop\Sistema - ALUFORCE - V.2"

echo Removendo arquivos de teste da raiz...
del /q teste-*.js 2>nul
del /q teste-*.html 2>nul
del /q test-*.js 2>nul
del /q test-*.html 2>nul
del /q verificar-*.js 2>nul
del /q validar-*.js 2>nul
del /q analisar_*.js 2>nul
del /q analisar_*.py 2>nul
del /q emitir-*.js 2>nul
del /q emitir_*.js 2>nul
del /q gerar-*.js 2>nul
del /q executar_*.js 2>nul
del /q migrar_*.js 2>nul
del /q demo-*.html 2>nul
del /q diagnosticar_*.js 2>nul
del /q diagnostico_*.js 2>nul
del /q varredura_*.js 2>nul
del /q sincronizar_*.js 2>nul
del /q buscar_*.js 2>nul
del /q chamar_*.js 2>nul
del /q check_*.js 2>nul
del /q contar_*.js 2>nul
del /q descobrir_*.js 2>nul
del /q descrever_*.js 2>nul
del /q exibir_*.js 2>nul
del /q inserir-*.js 2>nul
del /q criar_*.js 2>nul
del /q popular_*.js 2>nul
del /q remover-*.js 2>nul
del /q reset_*.js 2>nul
del /q relatorio_*.js 2>nul
del /q importar-*.js 2>nul
del /q launcher-*.html 2>nul
del /q executar-*.html 2>nul
del /q dashboard-integracao.html 2>nul
del /q *.bak 2>nul
del /q *.backup 2>nul
del /q *.tmp 2>nul
del /q *.zip 2>nul

echo Removendo pastas temporarias...
rmdir /s /q "temp_excel" 2>nul
rmdir /s /q "temp_jszip" 2>nul
rmdir /s /q "exceljs-real" 2>nul
rmdir /s /q ".nyc_output" 2>nul
rmdir /s /q "coverage" 2>nul
rmdir /s /q "backup_modules_20251207_193731" 2>nul
rmdir /s /q "backup_old_images" 2>nul

echo Removendo arquivos de teste em public...
cd public
del /q test_*.html 2>nul
del /q testar-*.html 2>nul
del /q demo-*.html 2>nul
del /q diagnostico-*.html 2>nul
rmdir /s /q "dashboard-testes" 2>nul
rmdir /s /q "ajuda_old_backup" 2>nul
cd ..

echo Removendo arquivos de teste em modules\PCP...
cd modules\PCP
del /q teste_*.js 2>nul
del /q teste_*.html 2>nul
del /q test_*.js 2>nul
del /q test_*.html 2>nul
del /q debug_*.js 2>nul
del /q debug_*.html 2>nul
del /q demo-*.html 2>nul
del /q demo_*.html 2>nul
del /q analisar_*.js 2>nul
del /q analisar_*.py 2>nul
del /q analise_*.js 2>nul
del /q verificar_*.js 2>nul
del /q validar_*.js 2>nul
del /q comparar_*.js 2>nul
del /q check_*.js 2>nul
del /q *.backup* 2>nul
del /q *.bak* 2>nul
del /q audit*.json 2>nul
del /q Teste_*.xlsx 2>nul
del /q TESTE_*.xlsx 2>nul
del /q teste_*.xlsx 2>nul
del /q *.sql 2>nul
cd ..\..

echo Removendo arquivos de teste em modules\RH...
cd modules\RH
del /q public\teste.html 2>nul
del /q public\test.html 2>nul
del /q public\quick-test.html 2>nul
del /q public\preview.html 2>nul
del /q public\*.bak* 2>nul
del /q *.backup* 2>nul
cd ..\..

echo.
echo === LIMPEZA CONCLUIDA ===
echo Execute novamente "code ." para recarregar o VS Code
pause
