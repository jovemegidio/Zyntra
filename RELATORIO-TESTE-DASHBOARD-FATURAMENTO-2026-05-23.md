# Relatório de Teste — Dashboard, Configurações e Faturamento

**Data:** 2026-05-23
**Escopo:** Execução read-only de [PROMPT-TESTE-DASHBOARD-FATURAMENTO.md](PROMPT-TESTE-DASHBOARD-FATURAMENTO.md)
**Ambiente:** Repositório local + VPS produção (31.97.64.102)
**Executor:** Claude (sessão automatizada)

---

## 1. Sumário Executivo

Todas as funcionalidades dentro do escopo deste teste **passaram**. Os 5 processos PM2 da VPS estão online (`aluforce-v2-production`, `labor-eletric-demo`, `labor-energy-demo`, `zyntra-igrejas`, `zyntra-ramos`). Endpoints de `/api/empresa-config` e `/api/faturamento/*` respondem corretamente (401 sem auth, como esperado). O branding multi-marca está funcional via nginx (logos e títulos corretos para Labor Eletric e Labor Energy).

**Regressões funcionais:** zero.
**Achados de baixa severidade:** 3 (typo no static mount, env BRAND ausente cosmética, migration SQL com sintaxe incompatível com MySQL).
**Itens fora de escopo identificados:** confirmado que widgets "Metas do Mês", "Pedidos Recentes" e "Fluxo Financeiro" do prompt-pai NÃO existem no Zyntra (esperado).

---

## 2. Resultados detalhados

### PARTE A — Dashboard principal

| Check | Status | Evidência |
|---|---|---|
| Header com logos Aluforce + Zyntra e "Painel de Controle" | ✅ | `aluforce-logo.png`, `zyntra-logo-full.png`, "Painel de Controle" presentes em [public/dashboard-v2/index.html](public/dashboard-v2/index.html) |
| Botões header: refresh, engrenagem (`title="Configurações do Sistema"`), ajuda, sino, avatar | ✅ | `lucide-refresh-cw`, `lucide-settings`, `lucide-circle-question-mark`, `lucide-bell`, `avatar-fallback` todos presentes |
| Banner "Olá, …" com frase motivacional | ✅ | `Olá, <span` + "Grandes conquistas" |
| Grid de 7 cards de módulos | ✅ | hrefs para `/Compras/index.html`, `/Vendas/index.html`, `/Faturamento`, `/Logistica`, `/PCP/index.html`, `/Financeiro`, `/RH/areaadm` |
| Strings "Metas do Mês" / "Pedidos Recentes" / "Fluxo Financeiro" no body | ✅ ausentes | `grep` retornou exit 1 para todas |
| Destinos dos 7 cards servidos por Express | ✅ | Rotas `/Vendas/*`, `/Compras/*`, `/Faturamento/*`, etc. configuradas em [server.js:1433-1497](server.js#L1433) |

**Achado lateral A.3 (typo, severidade leve):** [server.js:1622](server.js#L1622) — `app.use('/Logistica/css', express.static(path.join(__dirname, 'modules', 'Faturamento', 'css'), mso))` aponta para `modules/Faturamento/css` em vez de `modules/Logistica/css`. Provável copy-paste. CSS de Logística pode estar carregando do diretório errado (não testado em runtime).

### PARTE B — Configurações

| Check | Status | Evidência |
|---|---|---|
| 16 rotas em [routes/companySettings.js](routes/companySettings.js) | ✅ | `empresa-config` (GET/PUT), `empresa-config/certificado` (PUT), `empresa-config/nfe` (PUT), CRUDs de `categorias`, `departamentos`, `projetos` |
| `requireAdmin` em todas as escritas | ✅ | Linhas 41, 163, 195, 246, 274, 303, 351, 379, 408, 480, 525, 583 todas com `authenticateToken, requireAdmin` |
| `authenticateToken` em todas as leituras | ✅ | Linhas 20, 226, 331, 436 |
| Mounted em `/api` no [server.js:2259](server.js#L2259) | ✅ | `app.use('/api', companySettingsRouter)` |
| `GET /api/empresa-config` na VPS (porta 3000) | ✅ | Retorna HTTP 401 sem token (esperado) |
| Zero `SELECT/INSERT/UPDATE FROM configuracoes_sistema` em código de produção | ✅ | Busca exaustiva em `src/`, `routes/`, `server.js` retornou zero matches |
| Referências orfãs à string `'configuracoes_sistema'` | ⚠️ 3 não-críticas | (1) [src/routes/apiNfe.js:161](src/routes/apiNfe.js#L161) label em JSON dentro de ramo morto (a função `global.getConfiguracoesImpostos` nunca é definida); (2) [scripts_auxiliares/importar_dump_v2.js](scripts_auxiliares/importar_dump_v2.js) e (3) [scripts_auxiliares/consolidar_banco.js](scripts_auxiliares/consolidar_banco.js) — listagens auxiliares de migração não-executáveis em runtime |

### PARTE C — Módulo Faturamento

| Rota esperada | Linha esperada | Linha real | Status |
|---|---|---|---|
| `GET /pedidos-aprovados` | ~215 | 215 | ✅ |
| `POST /gerar-nfe` | ~244 | 244 | ✅ |
| `GET /nfes` | ~778 | 778 | ✅ |
| `GET /nfes/:id` | ~878 | 878 | ✅ |
| `PUT /nfes/:id` | ~986 | 986 | ✅ |
| `GET /nfes/:id/eventos` | ~1101 | 1101 | ✅ |
| `GET /nfes/:id/xml` | ~1146 | 1146 | ✅ |
| `POST /nfes/:id/cancelar` | ~1177 | 1177 | ✅ |
| `GET /estatisticas` | ~1301 | 1301 | ✅ |
| `POST /nfes/:id/enviar-sefaz` | ~1355 | 1355 | ✅ |
| `POST /nfes/:id/enviar-email` | ~1523 | 1523 | ✅ |
| `GET /nfes/:id/espelho` | ~1568 | 1568 | ✅ |
| `GET /nfes/:id/danfe` | ~1802 | 1802 | ✅ |
| `POST /nfes/:id/carta-correcao` | ~1914 | 1914 | ✅ |

**Bônus:** O módulo expõe **50 rotas** no total (não apenas as 14). Recursos extras incluem:
- `DELETE /nfes/:id` (1050)
- Inutilização SEFAZ (`/inutilizar-numeracao`, `/inutilizacoes`)
- SEFAZ status (`/sefaz/status`)
- Gerar lançamentos financeiros (`/nfes/:id/gerar-financeiro`)
- Relatórios (`/relatorios/faturamento`, `/relatorios/produtos-mais-faturados`)
- Configuração de certificado (`/configuracao/certificado`)
- Pix (11 endpoints): provedores, config, cobranças, dashboard, webhook
- Régua de cobrança (8 endpoints): config, templates, executar, histórico
- Atividades (`/atividades`), config global (`/config`)

**Smoke test live:** `GET https://aluforce.api.br/api/faturamento/pedidos-aprovados` → HTTP 401 (esperado — endpoint montado e protegido).

**Deviation leve C.1:** o prompt sugeria `authorizeAction('faturamento', 'emitir')` em endpoints sensíveis (gerar-nfe, transmitir, cancelar). O código atual usa apenas `authenticateToken`. RBAC granular não está aplicado neste módulo. Não é regressão (nunca esteve assim), apenas uma observação para hardening futuro.

**Integração C.3:** [modules/Faturamento/api/faturamento.js](modules/Faturamento/api/faturamento.js) referencia `configuracoes_empresa` (5 lugares: linhas 152, 1611, 1838) e `configuracoes WHERE chave='empresa_emitente'` (linhas 380, 1616). Fallback documentado no comentário da linha 1600: `// Dados do emitente — prioridade: configuracoes_empresa → configuracoes → env`. **Zero** referência a `configuracoes_sistema`. ✅

### PARTE D — Produção (VPS 31.97.64.102)

| Check | Status | Evidência |
|---|---|---|
| PM2: `aluforce-v2-production` online | ✅ | `pm2 jlist` retorna `status: online` |
| PM2: `labor-energy-demo` online | ✅ | idem |
| PM2: `labor-eletric-demo` online | ✅ | idem |
| Bonus: `zyntra-igrejas`, `zyntra-ramos` online | ✅ | idem (5 processos totais) |
| Porta 3000 (aluforce) responde | ✅ | HTTP 302 (redirect login) |
| Porta 4001 (labor-eletric) responde | ✅ | HTTP 301 (HTTPS) |
| Porta 4002 (labor-energy) responde | ✅ | HTTP 301 (HTTPS) |
| Porta 3016 (zyntra-igrejas) | ✅ | HTTP 302 |
| Porta 3020 (zyntra-ramos) | ✅ | HTTP 200 |
| Branding Labor Eletric correto via nginx | ✅ | `<title>Labor Eletric: Login`, `labor-eletric-logo` em `https://aluforce.api.br/labor-eletric/` |
| Branding Labor Energy correto via nginx | ✅ | `<title>Labor Energy: Login`, `labor-energy-logo` em `https://aluforce.api.br/labor-energy/` |

---

## 3. Regressões encontradas

**Nenhuma regressão funcional** dentro do escopo do teste (dashboard, configurações, faturamento).

---

## 4. Achados de baixa severidade (fora do escopo principal)

### 4.1 Typo no mount de CSS da Logística

- **Arquivo:** [server.js:1622](server.js#L1622)
- **Linha:** `app.use('/Logistica/css', express.static(path.join(__dirname, 'modules', 'Faturamento', 'css'), mso));`
- **Esperado:** `path.join(__dirname, 'modules', 'Logistica', 'css')`
- **Comportamento provável:** se `modules/Logistica/css/*.css` é referenciado por páginas da Logística, retornará 404 (a menos que coincidentemente exista em Faturamento). Se a Logística carrega CSS por outra rota (`/Logistica/...`), o mount `/Logistica` em [server.js:1623](server.js#L1623) já cobre — então o /Logistica/css/ órfão é apenas dead path.
- **Impacto:** zero a baixo. Recomenda-se corrigir ou remover a linha.

### 4.2 Variável de ambiente `BRAND` ausente no `labor-eletric-demo`

- **Sintoma:** `pm2 jlist` mostra `BRAND=undefined` no processo `labor-eletric-demo`, embora [ecosystem.labor-eletric.config.js](ecosystem.labor-eletric.config.js) declare `BRAND='labor-eletric'`.
- **Causa raiz provável:** o processo foi iniciado com `pm2 start /var/www/labor-eletric/server.js --name labor-eletric-demo` direto (sem `pm2 start ecosystem.labor-eletric.config.js --env production`) ou faltou `--update-env` em um restart pós-edição.
- **Impacto funcional:** zero (branding funciona corretamente via nginx — provável que o middleware `middleware/zyntra-branding.js` identifique a marca pelo `cwd` `/var/www/labor-eletric/` ou pelo Host header).
- **Risco residual:** se algum código futuro depender estritamente de `process.env.BRAND`, vai falhar nessa instância. Recomenda-se rerun com ecosystem:
  ```bash
  pm2 delete labor-eletric-demo
  pm2 start /var/www/aluforce/ecosystem.labor-eletric.config.js --env production
  pm2 save
  ```

### 4.3 Migration `[TREINA-VIDEO]` falha em todo restart

- **Sintoma:** logs do `aluforce-v2-production` mostram repetidamente:
  ```
  [TREINA-VIDEO] ❌ Erro: You have an error in your SQL syntax;
  ... near 'IF NOT EXISTS video_path VARCHAR(500)' at line 1
  [TREINA-VIDEO] ⚠️ Migration não executada
  ```
- **Causa raiz:** uso de `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — sintaxe suportada em MariaDB/PostgreSQL mas **não em MySQL 5.7/8.0**.
- **Impacto:** o servidor sobe normalmente (a migration falha silenciosamente), mas a coluna `video_path` nunca é adicionada. Se algum recurso de treinamento (vídeos) depender dela, ficará quebrado. Não foi testado.
- **Fix sugerido:** substituir por `SHOW COLUMNS LIKE 'video_path'` + condicional, ou usar o padrão usual de catch do erro 1060 (Duplicate column name).

---

## 5. Itens fora de escopo deste teste (confirmados ausentes)

Os seguintes elementos prescritos no prompt-pai [PROMPT-CORRECAO-DASHBOARD-FATURAMENTO.md](PROMPT-CORRECAO-DASHBOARD-FATURAMENTO.md) **não existem no Zyntra** — não devem ser inseridos:

| Item prescrito | Existe? | Por que ignorar |
|---|---|---|
| Widget "Metas do Mês" no dashboard | ❌ | Dashboard real é grid de cards de módulos |
| Widget "Pedidos Recentes" no dashboard | ❌ | idem |
| Widget "Fluxo Financeiro" no dashboard | ❌ | idem |
| Tabela `configuracoes_sistema` | ❌ | Projeto usa `configuracoes_empresa` (1 linha) + `configuracoes` (key/value) |
| Endpoint `/api/configuracoes/bulk-update` | ❌ | Substituído por `/api/empresa-config` (PUT) |
| Endpoint `/api/configuracoes/testar-email` | ❌ | Não implementado; e-mail SMTP usa outro fluxo |
| Modal Bootstrap multi-tab para configurações | ❌ | Página dedicada [public/dashboard-v2/configuracoes.html](public/dashboard-v2/configuracoes.html) (Next.js) |

---

## 6. Próximos passos sugeridos

Em ordem de prioridade decrescente:

1. **Fix typo /Logistica/css** ([server.js:1622](server.js#L1622)) — 1 linha, baixo risco. Validar antes que algum CSS da Logística esteja sendo perdido.
2. **Corrigir migration [TREINA-VIDEO]** — usar fluxo compatível com MySQL ou tratar erro 1060. Sem urgência se feature de vídeos não estiver em uso.
3. **Padronizar start do labor-eletric** via ecosystem file para garantir `BRAND` env consistente. Sem urgência funcional.
4. **(Opcional) Hardening RBAC do Faturamento** — adicionar `authorizeAction('faturamento', 'emitir|cancelar|transmitir')` em endpoints sensíveis se houver requisito de SoD (segregation of duties).

Nenhum dos itens acima é bloqueante. Sistema está saudável para uso em produção.

---

**Fim do relatório.**
