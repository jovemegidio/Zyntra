# =============================================================================
# SCRIPT DE LIMPEZA DO PROJETO ALUFORCE
# =============================================================================
# Este script move arquivos de desenvolvimento e temporários para uma pasta
# de arquivo, mantendo o projeto limpo e organizado para produção.
# =============================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   LIMPEZA DO PROJETO ALUFORCE" -ForegroundColor Cyan  
Write-Host "   Versão 11.12 - 24/12/2025" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = $PSScriptRoot
$archiveFolder = Join-Path $projectRoot "_ARQUIVOS_DESENVOLVIMENTO_ARQUIVADOS"

# Criar pasta de arquivo se não existir
if (-not (Test-Path $archiveFolder)) {
    New-Item -ItemType Directory -Path $archiveFolder | Out-Null
    Write-Host "[+] Pasta de arquivo criada: $archiveFolder" -ForegroundColor Green
}

# Subpastas para organização
$subfolders = @(
    "scripts-migracao",
    "scripts-teste",
    "scripts-correcao",
    "scripts-validacao",
    "scripts-desenvolvimento",
    "documentacao-antiga",
    "backups-sql",
    "arquivos-temporarios"
)

foreach ($subfolder in $subfolders) {
    $path = Join-Path $archiveFolder $subfolder
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
    }
}

Write-Host ""
Write-Host "[i] Iniciando categorização de arquivos..." -ForegroundColor Yellow
Write-Host ""

# Contadores
$totalMoved = 0

# Função para mover arquivo
function Move-ToArchive {
    param(
        [string]$FileName,
        [string]$Subfolder
    )
    
    $source = Join-Path $projectRoot $FileName
    $dest = Join-Path $archiveFolder $Subfolder
    
    if (Test-Path $source) {
        Move-Item -Path $source -Destination $dest -Force -ErrorAction SilentlyContinue
        if ($?) {
            Write-Host "  [>] $FileName -> $Subfolder" -ForegroundColor DarkGray
            return 1
        }
    }
    return 0
}

# =============================================================================
# ARQUIVOS DE MIGRAÇÃO E BANCO DE DADOS
# =============================================================================
Write-Host "[ ] Scripts de Migração" -ForegroundColor Magenta

$migrationFiles = @(
    "adapt_compras_tables.js",
    "adicionar_colunas_financeiro.js",
    "adicionar_colunas_financeiro_final.js",
    "ajustar_permissoes_pcp_rh.js",
    "chamar_migration.js",
    "create_compras_pages.js",
    "create_compras_tables.js",
    "create_missing_tables.js",
    "create_tables_simple.js",
    "criar_tabelas_financeiro.bat",
    "executar_fix_bancos.js",
    "executar_integracao.js",
    "executar_integracao_simples.js",
    "executar_migracao_financeiro.js",
    "executar_migracao_integracao.js",
    "executar_migracao_manual.js",
    "executar_migracao_simples.js",
    "executar_migration_agora.js",
    "executar_permissoes.js",
    "executar_schema_nfe.js",
    "executar_sql.js",
    "injetar_endpoint_migration.js",
    "migrar_estoque_pcp.js",
    "migrar_produtos_colunas.js",
    "migrar_rh_fase1.js",
    "migrar_rh_fase2.js",
    "migrar_rh_fase3.js",
    "migrar_rh_fase4.js",
    "migrar_rh_fase5.js",
    "migrar_rh_fase6.js",
    "migrar_status_pedidos.js",
    "migration_via_servidor.js",
    "migration_integracao_compras_financeiro.js"
)

foreach ($file in $migrationFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "scripts-migracao"
}

# =============================================================================
# ARQUIVOS DE TESTE
# =============================================================================
Write-Host "[ ] Scripts de Teste" -ForegroundColor Magenta

$testFiles = @(
    "test-api-excel.js",
    "test-excel-generation.js",
    "test-modal-debug.html",
    "test-permissoes.js",
    "test-system.ps1",
    "teste-api-direto.js",
    "teste-api-final.js",
    "teste-api-rapido.js",
    "teste-autocomplete.html",
    "teste-automatico-completo.js",
    "teste-automatico-interface.html",
    "teste-chat-widget.html",
    "teste-debug-pcp.js",
    "teste-excel-direto.js",
    "teste-exceljs-completo.js",
    "teste-exceljs-formulas.js",
    "teste-exceljs-opcoes-save.js",
    "teste-exceljs.csv",
    "teste-formatacao-preservada.js",
    "teste-gerador-direto.js",
    "teste-inatividade.html",
    "teste-mapeamento-completo.js",
    "teste-melhorias-autocomplete.js",
    "teste-modal-completo-fluxo.js",
    "teste-modal-completo.js",
    "teste-modal-debug.js",
    "teste-modal-final-dados.js",
    "teste-modal-navegador.js",
    "teste-modal-novo-mapeamento.js",
    "teste-modal-ordem-producao.js",
    "teste-modal-ordem.html",
    "teste-modificar-distante.js",
    "teste-modificar-linha45.js",
    "teste-novo-mapeamento.js",
    "teste-preenchimento-forcado.js",
    "teste-rapido-api.js",
    "teste-rotas-rh.js",
    "teste-simples-i45.js",
    "teste-sincronizacao-estoque.html",
    "teste-sistema-completo.js",
    "teste-template-direto.js",
    "teste-template-preservar-formulas.js",
    "testes_completos_10_10.js",
    "testar_modulos.ps1",
    "criar_dados_simples.js",
    "criar_dados_teste_final.js",
    "criar_dados_teste_integracao.js",
    "criar_usuario_teste.js",
    "criar_usuario_teste_v2.js",
    "executar-teste.html",
    "relatorio_teste_final.js",
    "reset_and_test.js"
)

foreach ($file in $testFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "scripts-teste"
}

# =============================================================================
# ARQUIVOS DE CORREÇÃO
# =============================================================================
Write-Host "[ ] Scripts de Correção" -ForegroundColor Magenta

$correctionFiles = @(
    "correcao-completa-pcp.js",
    "corrigir-chat-completo.bat",
    "limpar-arquivos-teste.ps1",
    "limpar-cache-completo.bat",
    "limpar_estilos_inline.js",
    "remover-produtos-teste.js",
    "remover_chat_omie_restaurar_bob.js",
    "remover_dom_duplicados.js",
    "remove_old_chat.js",
    "remove-topbars-duplicados.ps1",
    "script-final.js",
    "script-preencher-modal.js",
    "script_correcao_definitiva.js",
    "fix-index-duplicates.py"
)

foreach ($file in $correctionFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "scripts-correcao"
}

# =============================================================================
# ARQUIVOS DE VALIDAÇÃO
# =============================================================================
Write-Host "[ ] Scripts de Validação" -ForegroundColor Magenta

$validationFiles = @(
    "validacao_final_avatars.js",
    "validacao_melhorias.js",
    "validar-arquivo-gerado.js",
    "validar-corrigido.js",
    "validar-formulas-geradas.js",
    "validar_chat_omie.js",
    "validar_chat_omie_style.js",
    "validar_compras_chat.js",
    "validar_compras_final.js",
    "validar_correcoes.js",
    "validar_correcoes_rapido.js",
    "validar_correcoes_recursos.js",
    "validar_modulo_compras.js",
    "varredura_bugs_modulos.js",
    "varredura_completa_10_10.js",
    "varredura_modulos.js",
    "verificacao-completa.js",
    "verificacao_final.js",
    "verificacao_final_completa.js",
    "verificar-celulas.js",
    "verificar-estrutura-produtos.js",
    "verificar-excel-final.js",
    "verificar-pedidos.js",
    "verificar-produtos-ausentes.js",
    "verificar-produtos-modal.js",
    "verificar-template-vazio.js",
    "verificar_colunas_contas.js",
    "verificar_estrutura.js",
    "verificar_estrutura_bancos.js",
    "verificar_estrutura_financeiro.js",
    "verificar_fornecedores.js",
    "verificar_migracao_rh.js",
    "verificar_planilhas_modelo.py",
    "verificar_tabelas.js",
    "verificar_tabelas_financeiro.js"
)

foreach ($file in $validationFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "scripts-validacao"
}

# =============================================================================
# SCRIPTS DE DESENVOLVIMENTO
# =============================================================================
Write-Host "[ ] Scripts de Desenvolvimento" -ForegroundColor Magenta

$devFiles = @(
    "analisar_modelo_excel_op.py",
    "analisar_modulo_rh.js",
    "analisar_qualidade_texto.js",
    "aplicar_chat_simples.ps1",
    "aplicar_chat_todos_modulos.ps1",
    "aplicar_css_omie_completo.js",
    "aplicar_otimizacoes.ps1",
    "aplicar_rh_fase1.js",
    "atualizar-variacoes-labor.js",
    "atualizar-variacoes-produtos.js",
    "atualizar_chat_timestamp.js",
    "atualizar_chat_versao.js",
    "atualizar_chat_visual.js",
    "atualizar_compras_sidebar.js",
    "atualizar_email_teste.js",
    "atualizar_favicon_completo.js",
    "atualizar_favicon_todos.js",
    "atualizar_modulos_visual.ps1",
    "atualizar_sidebar_compras.js",
    "atualizar_timestamps_completo.ps1",
    "atualizar_vendas_padrao_pcp.js",
    "auditoria-completa-pcp.js",
    "buscar_usuarios.js",
    "check_database.js",
    "check_nfe_status.js",
    "check_status_enum.js",
    "configurar-favicon-global.ps1",
    "configurar-favicon-simples.ps1",
    "contar_produtos.js",
    "converter-imagens-webp.js",
    "converter_rh_padrao_pcp.js",
    "descobrir_senha.js",
    "descrever_tabela.js",
    "diagnosticar_chat.js",
    "diagnostico_financeiro_completo.js",
    "emitir-ordem-teste.js",
    "emitir_e_comparar_ordem.js",
    "emitir_ordem_automatizada.js",
    "emitir_ordem_definitivo.js",
    "emitir_ordem_mapeamento_pcpii.js",
    "emitir_ordem_padrao_final.js",
    "emitir_ordem_pcpii_estilo.js",
    "emitir_ordem_producao.js",
    "emitir_ordem_template_correto.js",
    "emitir_ordem_via_api.js",
    "exibir_permissoes_teste.js",
    "exportar_credenciais.js",
    "fazer_dump_database.js",
    "finalizar_nfe_visual.js",
    "generate-icons.js",
    "gerador_excel_manual.js",
    "gerar-exemplo-visual.js",
    "gerar-ordem-automatico.js",
    "gerar-ordem-producao.js",
    "gerar-ordem-teste.js",
    "gerarOrdemProducao_CORRETO.js",
    "gerar_token_teste.js",
    "implementar_reserva_estoque.js",
    "importar-produtos-aluforce.js",
    "importar_clientes.js",
    "importar_clientes_v2.js",
    "importar_transportadoras.js",
    "info_permissoes.js",
    "inicializar_compras.ps1",
    "inserir-pedidos-final.js",
    "inserir-pedidos-v2.js",
    "inserir-pedidos.js",
    "investigar_excel_problema.js",
    "localizar_div_final.js",
    "mapear_labels_exatos.js",
    "mapear_modelo_excel_completo.py",
    "novo_sistema_permissoes_funcao.js",
    "onde_esta_ordem.js",
    "otimizar-imagens-avancado.js",
    "otimizar_todos_modulos.js",
    "padronizar_compras_completo.js",
    "padronizar_nfe_pages.js",
    "padronizar_tudo_compras.js",
    "permissoes_funcao_v3.js",
    "popular_produtos_materiais.js",
    "preencher-corrigido.js",
    "processar_todos_clientes.js",
    "rebuild_compras_module.js",
    "relatorio_divergencias_pcp.js",
    "relatorio_permissoes_visual.js",
    "resumo_chat_omie_completo.js",
    "rotas_vendas_para_servidor_principal.js",
    "salvar_ordem_banco.js",
    "setup-user-antonio.js",
    "setup-user-ti.js",
    "setup_nfe_api.js",
    "setup_nfe_auto.js",
    "sincronizar_completo.js",
    "sincronizar_usuarios.js",
    "substituir_headers_compras.js",
    "template-xlsx-correto.js",
    "template-xlsx-final-correto.js",
    "template-xlsx-generator-BACKUP.js",
    "template-xlsx-real-generator.js",
    "update_permissions.js",
    "update_to_omie_chat.js",
    "vendas-apis.js",
    "ver-estrutura-pedidos.js",
    "apis_financeiro_parte1.js",
    "apis_financeiro_parte2.js"
)

foreach ($file in $devFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "scripts-desenvolvimento"
}

# =============================================================================
# DOCUMENTAÇÃO ANTIGA / DUPLICADA
# =============================================================================
Write-Host "[ ] Documentação Antiga" -ForegroundColor Magenta

$docFiles = @(
    "ATUALIZACAO_HEADER_SIDEBAR_PCP.md",
    "ATUALIZACAO_MODULO_NFE.md",
    "ATUALIZACAO_MODULO_VENDAS.md",
    "ATUALIZACOES_CHAT_VENDAS_2025-12-10.md",
    "BOB_AI_DOCUMENTACAO_COMPLETA.md",
    "CHAT_LIMPO_FINAL.md",
    "CHAT_SAAS_PREMIUM_v3.md",
    "CHAT_WIDGET_OMIE_STYLE.md",
    "CHAT_WIDGET_REIMPLEMENTACAO.md",
    "COMPARACAO_ORDEM_PRODUCAO_PCP.md",
    "CORRECOES_MODAIS_NOTIFICACOES.md",
    "CORRECOES_RECURSOS_20251210.md",
    "DOCUMENTACAO_CHAT_COMPLETA.md",
    "DOCUMENTACAO_COMPLETA_ATUALIZACOES.md",
    "DOCUMENTACAO_ENDPOINTS_REAIS.md",
    "DOCUMENTACAO_INTEGRACOES.md",
    "FASE_4_COMPLETA.md",
    "GUIA_CHAT.md",
    "GUIA_RAPIDO_CHAT.md",
    "GUIA_RAPIDO_VENDAS.md",
    "GUIA_TESTES_FINANCEIRO.md",
    "IMPLEMENTACAO_CHAT_DUAL_COMPLETA.md",
    "IMPLEMENTACAO_ORDEM_EXCEL_COMPLETA.md",
    "IMPLEMENTACAO_PROXIMOS_PASSOS.md",
    "INTEGRACAO_COMPRAS_FINANCEIRO.md",
    "INTEGRACAO_VENDAS_AUTENTICACAO.md",
    "LEIA-ME-OTIMIZACOES.md",
    "LEIA-ME_INSTALACAO.md",
    "LEIA_ME_PRIMEIRO.md",
    "MELHORIAS_VISUAIS_MODULOS_v3.md",
    "MIGRACAO_WEBP_COMPLETA.md",
    "MODULOS_PRONTOS.txt",
    "MODULO_COMPRAS_DASHBOARD_v3.md",
    "MODULO_FINANCEIRO_DASHBOARD_v3.md",
    "MODULO_FINANCEIRO_IMPLEMENTACAO_COMPLETA.md",
    "MODULO_NFE_DASHBOARD_v3.md",
    "MODULO_RH_ENTREGA_COMPLETA.md",
    "MODULO_VENDAS_COMPLETO.md",
    "MODULO_VENDAS_DOCUMENTACAO.md",
    "MODULO_VENDAS_IMPLEMENTADO.md",
    "MODULO_VENDAS_KANBAN_OMIE.md",
    "OTIMIZACOES_APLICADAS.md",
    "PERSONALIZACAO_CHAT_COMPLETA.txt",
    "PROJETO_CONCLUIDO.md",
    "PROXIMOS_PASSOS.md",
    "REINICIAR_SERVIDOR.md",
    "RELATORIO_FINAL_CORRECOES.md",
    "RELATORIO_FINAL_FINANCEIRO.md",
    "RELATORIO_SEGURANCA_CONCLUIDO.md",
    "RESUMO_CORRECOES_CHAT.txt",
    "RESUMO_EXECUTIVO.md",
    "RESUMO_FINAL_FINANCEIRO.md",
    "RESUMO_IMPLEMENTACAO.md",
    "RESUMO_INTEGRACOES_COMPLETO.md",
    "RESUMO_MELHORIAS_06_12_2025.md",
    "RESUMO_SPRINTS_1-4.md",
    "RESUMO_SPRINTS_1-6_COMPLETO.md",
    "RH_FASE1_CONCLUIDA.md",
    "RH_FASE2_CONTROLE_PONTO_COMPLETA.md",
    "SEGURANCA_URGENTE.md",
    "SPRINT_1_CERTIFICADO_CONCLUIDO.md",
    "SPRINT_2_NFE_COMPLETO.md",
    "SPRINT_3_SEFAZ_COMPLETO.md",
    "SPRINT_4_EVENTOS_COMPLETO.md",
    "SPRINT_5_DANFE_COMPLETO.md",
    "SPRINT_6_INUTILIZACAO_COMPLETO.md",
    "STATUS_IMPLEMENTACAO.md",
    "TRABALHO_CONCLUIDO.md",
    "VALIDACAO_MAPEAMENTO_TEMPLATE_EXCEL.md",
    "VARREDURA_DASHBOARD_PCP_COMPLETA.md",
    "VENDAS_KANBAN_IMPLEMENTADO.md",
    "VENDAS_MODULO_FINAL_02-12-2025.md",
    "FINANCEIRO_COMPLETO_README.md",
    "COMO_USAR.txt",
    "QUICK_START.txt"
)

foreach ($file in $docFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "documentacao-antiga"
}

# =============================================================================
# ARQUIVOS SQL AVULSOS
# =============================================================================
Write-Host "[ ] Arquivos SQL Avulsos" -ForegroundColor Magenta

$sqlFiles = @(
    "fix_contas_bancarias.sql",
    "importar_transportadoras.sql",
    "inserir_pedidos_vendas.sql",
    "limpar_produtos_nao_autorizados.sql",
    "migracao_impostos_vendas.sql",
    "migration_final_financeiro.sql",
    "migration_financeiro_completa.sql",
    "migration_financeiro_simples.sql",
    "migration_integracao.sql",
    "otimizacao_banco.sql",
    "populate_produtos.sql",
    "sp_calcular_impostos.sql"
)

foreach ($file in $sqlFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "backups-sql"
}

# =============================================================================
# ARQUIVOS TEMPORÁRIOS E DEMOS
# =============================================================================
Write-Host "[ ] Arquivos Temporários" -ForegroundColor Magenta

$tempFiles = @(
    "dashboard-integracao.html",
    "demo-chat-omie.html",
    "demo-chat-saas.html",
    "auditoria-pcp-2025-11-01.json",
    "clientes_importacao.csv",
    "EXEMPLO_ORDEM_PRODUCAO_VISUAL.xlsx",
    "exceljs-master.zip",
    "exceljs-standalone.js",
    "jszip-main.zip",
    "launcher-automatico.html",
    "native-xlsx-generator.js",
    "simple-xlsx-generator.js",
    "OTIMIZACAO_LOG_1764790146225.json",
    "relatorio-correcoes-pcp.json",
    "RELATORIO_FINAL.js",
    "relatorio_migracao_rh.json",
    "RELATORIO_DEFAULT_CORRECOES.json",
    "test_danfe_output.pdf",
    "VALIDACAO_FINAL.json",
    ".structure-plan.json",
    "server-otimizado.js",
    "server.err"
)

foreach ($file in $tempFiles) {
    $totalMoved += Move-ToArchive -FileName $file -Subfolder "arquivos-temporarios"
}

# =============================================================================
# RESULTADO FINAL
# =============================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   LIMPEZA CONCLUÍDA" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Arquivos movidos: $totalMoved" -ForegroundColor Green
Write-Host "  Pasta de arquivo: $archiveFolder" -ForegroundColor Yellow
Write-Host ""
Write-Host "[!] Os arquivos NÃO foram deletados, apenas movidos." -ForegroundColor Yellow
Write-Host "[!] Verifique a pasta de arquivo antes de excluir." -ForegroundColor Yellow
Write-Host ""

# Lista arquivos que permanecem na raiz
Write-Host "Arquivos que permanecem na raiz do projeto:" -ForegroundColor Cyan
Get-ChildItem -Path $projectRoot -File | Where-Object { 
    $_.Name -match "^(package|server|main|README|LICENSE|\.env|\.git|\.eslint|\.prettier|Aluforce|INICIAR|ecosystem)" -or
    $_.Extension -in @(".bat", ".vbs") -and $_.Name -match "^(Aluforce|INICIAR|Iniciar)"
} | ForEach-Object {
    Write-Host "  [*] $($_.Name)" -ForegroundColor White
}

Write-Host ""
Write-Host "Pressione qualquer tecla para sair..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
