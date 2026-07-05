# PROMPT DE TESTE - Auditoria de Templates, Branding e Chat

> Contexto: este prompt valida se a auditoria criada a partir de
> `PROMPT-AUDITORIA-TEMPLATES-BRANDING-CHAT.md` consegue rodar de forma
> reproduzivel no repositorio local do Zyntra ERP.

> Importante: este e um teste read-only sobre o produto. Ele pode gerar
> relatorios em `auditorias/templates-branding-chat/`, mas nao deve alterar
> paginas, templates, banco, servidor, deploy ou configuracoes de ambiente.

---

## Objetivo

Confirmar que os scripts de auditoria de templates, branding e chat existem,
executam sem erro e produzem relatorios JSON/Markdown com evidencias suficientes
para corrigir nao conformidades depois.

---

## Parte A - Integridade dos scripts

Verificar a existencia dos arquivos:

- `scripts/audit-templates-branding-chat.js`
- `scripts/audit-templates.js`
- `scripts/audit-branding.js`
- `scripts/audit-chat.js`
- `scripts/test-auditoria-templates-branding-chat.js`

Executar:

```bash
node scripts/audit-templates-branding-chat.js --scope=all --date=2026-05-23
```

Resultado esperado:

- O comando termina com exit code 0.
- O stdout mostra contagens de templates, branding, chat e score geral.
- Nenhuma dependencia nova e instalada.

---

## Parte B - Artefatos gerados

Confirmar que a pasta `auditorias/templates-branding-chat/` contem:

- `audit-full-report.json`
- `audit-templates-report.json`
- `audit-branding-report.json`
- `audit-chat-report.json`
- `audit-validation-matrix.json`
- `RELATORIO-AUDITORIA-TEMPLATES-BRANDING-CHAT-2026-05-23.md`

Validar o schema minimo:

- `audit-full-report.json` contem `templates`, `branding`, `chat`, `matrix`.
- `audit-templates-report.json.total` e maior que zero.
- `audit-branding-report.json.total` e maior que zero.
- `audit-chat-report.json.globalScore` e maior ou igual a 85.
- `audit-chat-report.json.backendEvidence` possui ao menos um arquivo.

---

## Parte C - Aplicacao do teste automatizado

Executar:

```bash
node scripts/test-auditoria-templates-branding-chat.js
```

Resultado esperado:

- O comando termina com exit code 0.
- O arquivo `RELATORIO-TESTE-AUDITORIA-TEMPLATES-BRANDING-CHAT-2026-05-23.md`
  e criado em `auditorias/templates-branding-chat/`.
- O relatorio final diferencia claramente:
  - integridade do auditor;
  - nao conformidades reais do produto;
  - limitacao de auditoria estatica sem Playwright.

---

## Regras

- Nao corrigir automaticamente templates, headers, sidebars ou chat.
- Nao criar migrations.
- Nao iniciar deploy.
- Nao apagar backups nem arquivos antigos.
- Reportar falhas com caminho de arquivo e evidencia.

---

**Fim do prompt de teste.**
