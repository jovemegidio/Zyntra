# Relatorio de Teste - Auditoria de Templates, Branding e Chat

**Data:** 2026-05-23
**Prompt aplicado:** PROMPT-TESTE-AUDITORIA-TEMPLATES-BRANDING-CHAT.md
**Modo:** Teste estatico local, sem servidor, sem banco e sem deploy

## Sumario executivo

O prompt de teste foi aplicado com sucesso. O auditor gerou os relatorios esperados, leu 25 templates/documentos, 186 paginas de branding e 186 paginas para cobertura estatica do chat. Score geral: 69%.

## Validacoes do teste

| Check | Status | Evidencia |
|---|---|---|
| Arquivo gerado: audit-full-report.json | OK | auditorias/templates-branding-chat/audit-full-report.json |
| Arquivo gerado: audit-templates-report.json | OK | auditorias/templates-branding-chat/audit-templates-report.json |
| Arquivo gerado: audit-branding-report.json | OK | auditorias/templates-branding-chat/audit-branding-report.json |
| Arquivo gerado: audit-chat-report.json | OK | auditorias/templates-branding-chat/audit-chat-report.json |
| Arquivo gerado: audit-validation-matrix.json | OK | auditorias/templates-branding-chat/audit-validation-matrix.json |
| Arquivo gerado: RELATORIO-AUDITORIA-TEMPLATES-BRANDING-CHAT-2026-05-23.md | OK | auditorias/templates-branding-chat/RELATORIO-AUDITORIA-TEMPLATES-BRANDING-CHAT-2026-05-23.md |
| Schema audit-full-report.json | OK | templates, branding, chat e matrix presentes |
| Templates encontrados | OK | 25 templates/documentos |
| Paginas de branding encontradas | OK | 186 paginas |
| Widget de chat global valido | OK | score global 100% |
| Evidencia backend chat | OK | 30 arquivos |

## Resultado resumido

| Area | Resultado |
|---|---:|
| Templates auditados | 25 |
| Paginas de branding auditadas | 186 |
| Paginas avaliadas para chat | 186 |
| Paginas com chat direto | 94 |
| Score global do widget chat | 100% |
| Score geral | 69% |

## Observacoes

- O teste valida a integridade do auditor e dos artefatos gerados.
- As nao conformidades de produto permanecem no relatorio de auditoria; este teste nao tenta corrigi-las.
- Para validar interacao real do chat, ainda e necessario rodar Playwright com servidor, login e banco disponiveis.

