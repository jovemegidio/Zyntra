# PROMPT DE TESTE — Dashboard, Configurações e Faturamento (Zyntra ERP)

> **Contexto:** Este prompt valida o estado real de produção do Zyntra. Ele NÃO assume que widgets como "Metas do Mês", "Pedidos Recentes" ou "Fluxo Financeiro" existam no dashboard — porque eles **não existem** no `public/dashboard-v2/`. O dashboard real é uma grid de 7 cards de módulos. Use este prompt para checar saúde funcional do que está efetivamente implementado.

> **Importante:** Este é um prompt de **validação read-only**. Não escreva código novo, não rode migrações, não faça deploy. Apenas leia arquivos, rode queries SELECT, e cheque endpoints. Reporte achados ao final.

---

## OBJETIVO

Verificar se o dashboard principal, o modal/página de configurações e o módulo de Faturamento do Zyntra ERP estão funcionais em produção (VPS `31.97.64.102`), com dados reais e sem regressões.

---

## PARTE A — DASHBOARD PRINCIPAL

### A.1 Estrutura esperada
Arquivo a inspecionar: [public/dashboard-v2/index.html](public/dashboard-v2/index.html)

Verificações:
- [ ] Existe header com logos Aluforce + Zyntra ("Painel de Controle")
- [ ] Existem botões no header: refresh, **engrenagem com `title="Configurações do Sistema"`**, ajuda, sino de notificações, avatar
- [ ] Existe banner "Olá, &lt;nome do usuário&gt;" com frase motivacional
- [ ] Existe grid de **7 cards** de módulos na ordem: Compras, Vendas, Faturamento, Logística, PCP, Financeiro, Recursos Humanos
- [ ] Cada card é um `<a href>` para o módulo correto: `/Compras/index.html`, `/Vendas/index.html`, `/Faturamento`, `/Logistica`, `/PCP/index.html`, `/Financeiro`, `/RH/areaadm`

Se ALGUM card estiver faltando ou apontar para rota errada → reporte como **REGRESSÃO**.

### A.2 Strings que NÃO devem existir
Não devem aparecer no HTML renderizado (`grep` no `index.html`):
- [ ] `Metas do Mês` / `metas-mes` / `id="metas-mes"`
- [ ] `Pedidos Recentes` no body (apenas em chunks JS bundled é aceitável)
- [ ] `Fluxo Financeiro` no body (apenas em chunks JS bundled é aceitável)

Se aparecerem renderizados no body → reporte: **widget legacy reapareceu, investigar**.

### A.3 Cards apontam para módulos vivos?
Para cada um dos 7 cards, faça `curl -I` no host de produção (ou local) e confirme HTTP 200 ou 302 (redirect autorizado), nunca 404/500:
```bash
for path in /Compras/index.html /Vendas/index.html /Faturamento /Logistica /PCP/index.html /Financeiro /RH/areaadm; do
  curl -s -o /dev/null -w "%{http_code} $path\n" http://localhost:3000$path
done
```

---

## PARTE B — MODAL/PÁGINA DE CONFIGURAÇÕES

### B.1 Backend de configuração
Arquivo: [routes/companySettings.js](routes/companySettings.js)

Verificações no código:
- [ ] Existem rotas `GET /api/empresa-config` e `PUT /api/empresa-config`
- [ ] `PUT` exige `requireAdmin`
- [ ] `PUT /api/empresa-config/certificado` existe (upload de certificado digital)
- [ ] `PUT /api/empresa-config/nfe` existe (config NFe: série, ambiente, próximo número)
- [ ] CRUD de `/api/categorias`, `/api/departamentos`, `/api/projetos`

Verificações no servidor rodando:
```bash
# autenticar primeiro e usar o cookie/token; substituir TOKEN abaixo
curl -s http://localhost:3000/api/empresa-config -H "Authorization: Bearer TOKEN" | head -100
```
- [ ] Retorna 200 com objeto contendo no mínimo: `cnpj`, `razao_social`, `nome_fantasia`, `inscricao_estadual`, `endereco`, `cidade`, `uf`, `cep`, `telefone`, `email`
- [ ] Não retorna 500
- [ ] Não retorna `null` em campos obrigatórios

### B.2 Schema real (não `configuracoes_sistema`!)
O Zyntra usa DUAS fontes:
- Tabela `configuracoes_empresa` (single-row): dados cadastrais da empresa
- Tabela `configuracoes` (key/value): chaves como `empresa_emitente`, configs livres

**ATENÇÃO:** Se algum arquivo do projeto referenciar `configuracoes_sistema` (tabela mencionada apenas no prompt antigo), reporte — pode ser código importado por engano. Comando:
```bash
grep -rn "configuracoes_sistema" --include="*.js" --include="*.sql" --include="*.html" .
```
Resultado esperado: **zero matches em código de produção** (apenas em markdown de prompts/documentação).

### B.3 Página de configurações renderizada
- [ ] Arquivo [public/dashboard-v2/configuracoes.html](public/dashboard-v2/configuracoes.html) abre como página standalone
- [ ] O botão de engrenagem no header do dashboard navega ou abre modal de configuração (testar manualmente no navegador)
- [ ] Não há erros 4xx/5xx no console ao abrir
- [ ] Campos pré-preenchidos com dados reais da empresa

---

## PARTE C — MÓDULO FATURAMENTO

### C.1 Endpoints existentes
Arquivo: [modules/Faturamento/api/faturamento.js](modules/Faturamento/api/faturamento.js) — **deve ter ≈ 3.040 linhas**.

Confirmar presença das rotas (montadas em `/api/faturamento/*` ou similar — verificar como é registrado no `server.js`):

| Rota | Linha esperada | Função |
|---|---|---|
| `GET  /pedidos-aprovados` | ~215 | Listar pedidos aprovados aguardando faturamento |
| `POST /gerar-nfe` | ~244 | Criar NFe a partir de pedido |
| `GET  /nfes` | ~778 | Listar NFes |
| `GET  /nfes/:id` | ~878 | Detalhes de uma NFe |
| `PUT  /nfes/:id` | ~986 | Editar NFe em rascunho |
| `GET  /nfes/:id/eventos` | ~1101 | Histórico de eventos SEFAZ |
| `GET  /nfes/:id/xml` | ~1146 | XML autorizado |
| `POST /nfes/:id/cancelar` | ~1177 | Cancelar NFe na SEFAZ |
| `GET  /estatisticas` | ~1301 | KPIs do módulo |
| `POST /nfes/:id/enviar-sefaz` | ~1355 | Transmitir NFe |
| `POST /nfes/:id/enviar-email` | ~1523 | Enviar XML+PDF para cliente |
| `GET  /nfes/:id/espelho` | ~1568 | Espelho HTML para conferência |
| `GET  /nfes/:id/danfe` | ~1802 | DANFE em PDF |
| `POST /nfes/:id/carta-correcao` | ~1914 | CC-e |

Se alguma rota retornar 404 quando o servidor está up → **REGRESSÃO**.

### C.2 Smoke tests funcionais
Pré-requisito: ter um pedido aprovado com `status='aprovado'` no banco.

1. **Listar pedidos pendentes**
   ```bash
   curl -s http://localhost:3000/api/faturamento/pedidos-aprovados -H "Authorization: Bearer TOKEN" | jq '.[0]'
   ```
   - [ ] Retorna array com ≥1 pedido se houver um aprovado no banco
   - [ ] Cada item tem: `id`, `numero_pedido`, `cliente_nome`, `cliente_cnpj`, `valor_total`, `data_pedido`

2. **Estatísticas**
   ```bash
   curl -s http://localhost:3000/api/faturamento/estatisticas -H "Authorization: Bearer TOKEN"
   ```
   - [ ] Retorna contadores numéricos (não null, não NaN)

3. **DANFE de uma NFe autorizada**
   ```bash
   curl -s -o /tmp/danfe.pdf -w "%{http_code} %{content_type}\n" \
     http://localhost:3000/api/faturamento/nfes/<ID_VALIDO>/danfe -H "Authorization: Bearer TOKEN"
   ```
   - [ ] Retorna 200 + `application/pdf`
   - [ ] Arquivo abre como PDF válido (`file /tmp/danfe.pdf` deve dizer "PDF document")

4. **Espelho HTML**
   - [ ] `GET /nfes/:id/espelho` retorna 200 + HTML legível, mostrando dados do emitente (vindos de `configuracoes_empresa`)

### C.3 Integração com configurações
Confirmar que o módulo de Faturamento lê dados da empresa do lugar certo:
```bash
grep -n "configuracoes_empresa\|empresa_emitente" modules/Faturamento/api/faturamento.js | head -20
```
- [ ] Linhas ~152, ~380, ~1611, ~1616, ~1838 referenciam essas tabelas
- [ ] **Não** existe `SELECT ... FROM configuracoes_sistema` em nenhum lugar

### C.4 Tabelas do banco
Confirmar que as tabelas centrais existem:
```sql
SHOW TABLES LIKE 'notas_fiscais';
SHOW TABLES LIKE 'nota_fiscal_itens';
SHOW TABLES LIKE 'pedidos';
SHOW TABLES LIKE 'configuracoes_empresa';
SHOW TABLES LIKE 'configuracoes';
DESCRIBE notas_fiscais;
```
- [ ] Todas existem
- [ ] `notas_fiscais` tem colunas: `id`, `numero`, `serie`, `chave_acesso`, `status`, `xml_enviado`, `xml_retorno`, `protocolo`, `data_emissao`, `data_autorizacao`
- [ ] **Não criar** tabela `configuracoes_sistema` — não é o schema usado

---

## PARTE D — VERIFICAÇÃO EM PRODUÇÃO (VPS)

Conectar na VPS via SSH (ver [CLAUDE.md](CLAUDE.md)):
```bash
ssh -i ~/.ssh/id_ed25519_vps root@31.97.64.102
```

Checks rápidos:
```bash
pm2 list                           # aluforce-v2-production deve estar 'online'
pm2 logs aluforce-v2-production --lines 50 --nostream | grep -iE "error|fail"
# Esperado: zero erros recentes relacionados a /api/empresa-config, /api/faturamento/*, dashboard
```

Para cada instância Labor:
```bash
pm2 list | grep -E "labor-energy-demo|labor-eletric-demo"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/   # labor-energy (porta exemplo)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/   # labor-eletric (porta exemplo)
```
- [ ] Ambas respondem 200/302
- [ ] Branding correto: logo verde (energy) vs laranja (eletric)

---

## PARTE E — RELATÓRIO FINAL

Gerar um arquivo `RELATORIO-TESTE-DASHBOARD-FATURAMENTO-<YYYY-MM-DD>.md` contendo:

1. **Sumário executivo** — 1 parágrafo: tudo OK / N regressões / M melhorias possíveis
2. **Tabela de resultados** — uma linha por checkbox acima, com status ✅ / ❌ / ⚠️ + evidência (linha de log, output do curl, screenshot)
3. **Regressões encontradas** — só falhas concretas, com:
   - Arquivo + linha
   - Comportamento esperado vs observado
   - Comando que reproduz
4. **Itens fora de escopo deste teste** — funcionalidades que o prompt antigo cobria mas que não existem no Zyntra (widgets de Metas/Pedidos/Fluxo no dashboard). Listar para evitar reanalisar no futuro.
5. **Próximos passos sugeridos** — só se houver achado real. Não inventar tarefas.

---

## REGRAS DO TESTE

- ❌ **Não criar tabelas novas** (nem `configuracoes_sistema`).
- ❌ **Não escrever código** — apenas auditar.
- ❌ **Não fazer deploy** — apenas leitura/queries SELECT.
- ❌ **Não rodar migrations**.
- ✅ Reportar achados literais, com evidência (paths + linhas + outputs).
- ✅ Se um endpoint do checklist não estiver montado no `server.js`, reportar como achado — não criar.
- ✅ Diferenciar claramente: "regressão" (algo que funcionava quebrou) vs "lacuna" (algo que nunca existiu) vs "melhoria" (otimização não-bloqueante).

---

**Fim do prompt de teste.**
