# Relatorio de Auditoria - Templates, Branding e Chat

**Data:** 2026-05-23
**Escopo:** Auditoria estatica local de templates, branding e chat
**Sistema:** Zyntra ERP Multi-Company

## Sumario executivo

Foram auditados 25 templates/documentos, 186 paginas de aplicacao e 186 paginas para cobertura estatica do chat. O score geral calculado foi 69%.

## Metricas

| Area | Total | OK/Bom | Atencao | Falha | Score |
|---|---:|---:|---:|---:|---:|
| Templates | 25 | 15 | 5 | 5 | 60% |
| Branding | 186 | 119 | 5 | 62 | 64% |
| Chat estatico | 186 | 94 com script direto | 140 com hint de layout | 92 sem script direto | 51% |
| Chat global | 7 checks | 7 | - | 0 | 100% |

## Checks globais do chat

| Check | Status | Severidade |
|---|---|---|
| Widget JS existe | OK | CRITICA |
| Widget CSS existe | OK | ALTA |
| Botao flutuante do chat no widget | OK | CRITICA |
| Janela/painel do chat no widget | OK | CRITICA |
| Entrada e envio de mensagem | OK | ALTA |
| Integracao realtime/socket | OK | ALTA |
| Backend/tabelas de chat encontrados | OK | ALTA |

## Principais nao conformidades

| Severidade | Area | Arquivo | Achado |
|---|---|---|---|
| ALTA | templates | public/templates/danfe-template.html | Logo ou marca no cabecalho nao identificado |
| ALTA | templates | public/templates/danfe-template.html | Dados ou nome da empresa nao identificado |
| ALTA | templates | public/templates/danfe-template.html | Titulo do documento nao identificado |
| ALTA | templates | public/templates/danfe-template.html | Tabela ou lista estruturada de itens nao identificado |
| ALTA | templates | public/templates/danfe-template.html | Totalizadores ou resumo nao identificado |
| ALTA | templates | public/relatorio-final-rh.html | Logo ou marca no cabecalho nao identificado |
| ALTA | templates | modules/Faturamento/public/danfe.html | Logo ou marca no cabecalho nao identificado |
| ALTA | templates | modules/Faturamento/public/danfe.html | Dados ou nome da empresa nao identificado |
| ALTA | templates | modules/Faturamento/public/danfe.html | Tabela ou lista estruturada de itens nao identificado |
| ALTA | templates | modules/Faturamento/public/danfe.html | Totalizadores ou resumo nao identificado |
| ALTA | templates | modules/PCP/templates/pcp-modals.html | Logo ou marca no cabecalho nao identificado |
| ALTA | templates | modules/PCP/templates/pcp-modals.html | Dados ou nome da empresa nao identificado |
| ALTA | templates | modules/PCP/gerar_ordem_excel.html | Logo ou marca no cabecalho nao identificado |
| ALTA | templates | modules/PCP/modal_nova_ordem_saas.html | Logo ou marca no cabecalho nao identificado |
| ALTA | templates | modules/_shared/layout-template.html | Titulo do documento nao identificado |
| ALTA | branding | public/print-manager/index.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/template-editor/index.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/admin/usuarios.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/admin/treinamentos.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/new_dashboard.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/new_dashboard_clean.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/new_dashboard_section.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/config-modals-extended.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/config-modals.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/index-pre-erp-20260129_133627.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/redefinir-senha.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/configure-vendas.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/setup-user-ti.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/esocial.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/limpar-hsts.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/logout.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/setup-user-test.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/offline-settings.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/modal-demo.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/relatorio-final-rh.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/limpar-sessao.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/mrp.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/setup-nfe.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/nfe-importar.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/config.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/manifestacao-nfe.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/clear-session.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/dashboard-v2/_not-found.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | public/dashboard-v2/404.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Faturamento/public/emitir.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Faturamento/public/emitir.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/Faturamento/public/danfe.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Faturamento/public/danfe.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/Faturamento/public/nfse.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Faturamento/public/nfse.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/Faturamento/public/logistica.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Faturamento/public/logistica.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/Faturamento/index.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Faturamento/nfe.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/RH/public/pages/popup-confirm.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/RH/public/pages/popup-confirm.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/RH/public/pages/importar-ponto_new.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/RH/public/pages/importar-ponto_new.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/Vendas/public/preview_augusto.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/Vendas/index.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/NFe/dashboard.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/NFe/logistica.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/NFe/logistica.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/NFe/nfe.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/NFe/pix.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/NFe/pix.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/NFe/regua.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/NFe/regua.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/PCP/mobile/scan.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/pages/relatórios.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/pages/relatórios.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/PCP/modal-produto-rico.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/sistema_funcional.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/sistema_funcional.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/PCP/INSTRUCOES_MODAL_NOVO.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/PATCH_INDEX_HTML.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/PATCH_INDEX_HTML.html | Nome de marca/sistema/empresa nao identificado |
| ALTA | branding | modules/PCP/modal-produto-enriquecido.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/limpar_cache.html | Logo ou imagem de marca nao identificado |
| ALTA | branding | modules/PCP/gerar_ordem_excel.html | Logo ou imagem de marca nao identificado |

## Amostra da matriz

| Pagina | Template | Branding | Chat | Status |
|---|---|---|---|---|
| public/print-manager/index.html | N/A | FALHA | FALHA | FALHA |
| public/template-editor/index.html | N/A | FALHA | FALHA | FALHA |
| public/admin/usuarios.html | N/A | ATENCAO | FALHA | FALHA |
| public/admin/treinamentos.html | N/A | FALHA | FALHA | FALHA |
| public/new_dashboard.html | N/A | FALHA | FALHA | FALHA |
| public/new_dashboard_clean.html | N/A | FALHA | FALHA | FALHA |
| public/new_dashboard_section.html | N/A | FALHA | FALHA | FALHA |
| public/modal-configuracoes-content.html | N/A | FALHA | FALHA | FALHA |
| public/config-modals-extended.html | N/A | FALHA | FALHA | FALHA |
| public/config-modals.html | N/A | FALHA | FALHA | FALHA |
| public/index-pre-erp-20260129_133627.html | N/A | BOM | FALHA | FALHA |
| public/redefinir-senha.html | N/A | FALHA | FALHA | FALHA |
| public/app/download.html | N/A | FALHA | FALHA | FALHA |
| public/configure-vendas.html | N/A | FALHA | FALHA | FALHA |
| public/setup-user-ti.html | N/A | FALHA | FALHA | FALHA |
| public/esocial.html | N/A | FALHA | FALHA | FALHA |
| public/limpar-hsts.html | N/A | FALHA | FALHA | FALHA |
| public/logout.html | N/A | FALHA | FALHA | FALHA |
| public/index-emergent.html | N/A | BOM | FALHA | FALHA |
| public/reset-password.html | N/A | FALHA | FALHA | FALHA |
| public/setup-user-test.html | N/A | FALHA | FALHA | FALHA |
| public/offline-settings.html | N/A | FALHA | FALHA | FALHA |
| public/esqueci-senha.html | N/A | FALHA | FALHA | FALHA |
| public/modal-demo.html | N/A | FALHA | FALHA | FALHA |
| public/relatorio-final-rh.html | FALHA | FALHA | FALHA | FALHA |
| public/limpar-sessao.html | N/A | FALHA | FALHA | FALHA |
| public/mrp.html | N/A | FALHA | FALHA | FALHA |
| public/404.html | N/A | FALHA | FALHA | FALHA |
| public/index-new.html | N/A | BOM | FALHA | FALHA |
| public/setup-nfe.html | N/A | FALHA | FALHA | FALHA |
| public/nfe-importar.html | N/A | FALHA | FALHA | FALHA |
| public/config.html | N/A | FALHA | FALHA | FALHA |
| public/manifestacao-nfe.html | N/A | FALHA | FALHA | FALHA |
| public/clear-session.html | N/A | FALHA | FALHA | FALHA |
| public/login.html | N/A | ATENCAO | FALHA | FALHA |
| public/index.html | N/A | BOM | OK | BOM |
| public/dashboard-v2/rh.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/vendas.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/logistica.html | N/A | OK | FALHA | FALHA |
| public/dashboard-v2/_not-found.html | N/A | FALHA | FALHA | FALHA |
| public/dashboard-v2/index.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/pcp.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/estoque.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/compras.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/faturamento.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/financeiro.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/ajuda.html | N/A | BOM | FALHA | FALHA |
| public/dashboard-v2/404.html | N/A | FALHA | FALHA | FALHA |
| public/dashboard-v2/configuracoes.html | N/A | BOM | FALHA | FALHA |
| modules/Faturamento/public/emitir.html | N/A | FALHA | FALHA | FALHA |
| modules/Faturamento/public/danfe.html | FALHA | FALHA | FALHA | FALHA |
| modules/Faturamento/public/consultar.html | N/A | OK | OK | OK |
| modules/Faturamento/public/dashboard.html | N/A | OK | OK | OK |
| modules/Faturamento/public/relatorios.html | BOM | OK | OK | OK |
| modules/Faturamento/public/nfse.html | N/A | FALHA | FALHA | FALHA |
| modules/Faturamento/public/index.html | N/A | OK | OK | OK |
| modules/Faturamento/public/eventos.html | N/A | OK | OK | OK |
| modules/Faturamento/public/logistica.html | N/A | FALHA | FALHA | FALHA |
| modules/Faturamento/public/inutilizacao.html | N/A | BOM | OK | BOM |
| modules/Faturamento/index.html | N/A | FALHA | OK | FALHA |

## Observacoes

- Esta auditoria e estatica: ela valida arquivos, referencias e padroes, mas nao substitui um teste Playwright com servidor e login reais.
- Paginas sem referencia direta ao `chat-widget.js` foram marcadas como falha de cobertura estatica mesmo que o servidor possa injetar o widget em runtime.
- Backups, node_modules, uploads, logs e artigos de ajuda foram excluidos para reduzir ruido.

## Arquivos gerados

- `audit-full-report.json`
- `audit-templates-report.json`
- `audit-branding-report.json`
- `audit-chat-report.json`
- `audit-validation-matrix.json`

