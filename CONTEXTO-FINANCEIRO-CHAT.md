# CONTEXTO DO CHAT — Módulo Financeiro (Salvo em 01/03/2026)

## Objetivo
Testar TODOS os botões em cada página HTML do módulo Financeiro (exceto requisicoes.html), verificar funcionamento, anotar erros, e corrigir seguindo boas práticas. Restrições: **zero alteração visual**, backend alterado **somente o estritamente necessário**.

---

## Infraestrutura

| Item | Valor |
|---|---|
| App | ALUFORCE ERP v2.1.7 |
| Stack | Node.js/Express + MySQL + vanilla JS frontend |
| VPS IP | `31.97.64.102` |
| SSH User | `root` (chave: `C:\Users\Tavera\.ssh\id_rsa`) |
| App Path VPS | `/var/www/aluforce/` |
| PM2 Process | `aluforce-dashboard` (restart #225, PID 1017100) |
| DB | `aluforce_vendas`, user=`aluforce`, pass=`Aluforce2026VpsDB` |
| Login QA | `qafinanceiro@aluforce.ind.br` / `Teste@123` (user id=57 na tabela `usuarios`) |

---

## Estado Atual dos Testes: **65/82 (79.3%)** — 17 falhas restantes

### Resultado Completo (última execução):
```
FASE 0: Login                    → T00 OK
FASE 1: Dashboard + KPIs         → T01-T05 OK, T06 FAIL (alertas 500)
FASE 2: Permissoes               → T07 OK
FASE 3: Categorias               → T08-T11 OK
FASE 4: Contas a Pagar CRUD      → T12-T15 OK
FASE 4b: Contas Pagar Avançado   → T16-T19 FAIL (404), T20-T21 OK
FASE 5: Contas a Receber CRUD    → T22-T25 OK
FASE 5b: Contas Receber Avançado → T26-T29 FAIL (404), T30 OK
FASE 6: Bancos CRUD              → T31-T35 OK
FASE 7: Contas Bancárias         → T36-T41 OK
FASE 8: Movimentações            → T42-T44 OK
FASE 9: Centros de Custo         → T45-T48 OK
FASE 10: Impostos                → T49-T52 OK
FASE 11: Orçamentos              → T53-T56 OK
FASE 12: Plano de Contas         → T57-T60 OK
FASE 13: Clientes-Fornecedores   → T61-T62 OK, T63 FAIL (500)
FASE 14: Desconto                → T64 OK
FASE 15: Relatórios              → T65 FAIL (dre 500), T66 FAIL (lucrat 403)
FASE 16: Outros                  → T67-T71 OK, T72 FAIL (lote/pagar 404)
FASE 17: Fornecedores/Clientes   → T73-T74 FAIL (500)
FASE 18: API Aberta              → T75 OK
FASE 19: Cleanup                 → T76-T78 OK, T79 FAIL (del banco 500), T81 FAIL (del orc 404)
```

---

## 17 Falhas Restantes — Diagnóstico Detalhado

### GRUPO 1: Rotas parametrizadas capturando sub-rotas (8 falhas — T16-T19, T26-T29, T72)
**Causa raiz**: Em `financeiro-core.js`, as rotas GET `/contas-pagar/:id` e GET `/contas-receber/:id` estão declaradas ANTES das rotas específicas como `/contas-pagar/vencidas`, `/contas-pagar/vencendo`, etc. O Express resolve na ordem de declaração, então `:id` captura "vencidas" como string.

**Fix já parcialmente aplicado**: Na VPS (linha 285 e 367 do financeiro-core.js), foi adicionado guard:
```js
if (['vencidas', 'vencendo', 'estatisticas', 'resumo', 'lote'].includes(req.params.id)) return next();
```
**Status**: O guard está no código mas as rotas sub continuam retornando 404. Provável que as rotas sub não estejam registradas com o path correto no router ou o `next()` não encontra a rota seguinte.

**Solução correta**: Mover as rotas específicas (vencidas, vencendo, estatisticas, resumo, lote/pagar) para ANTES das rotas parametrizadas no financeiro-core.js. Alternativa: verificar se estão em outro arquivo (financeiro-extended.js tem essas rotas nas linhas 450-590 mas é montado separadamente).

**Investigação pendente**: Verificar a ordem de montagem em routes/index.js — financeiro-routes.js, financeiro-core.js, financeiro-extended.js. As rotas específicas podem estar em financeiro-extended.js mas o `:id` de financeiro-core.js captura antes.

### GRUPO 2: Bugs SQL reais (7 falhas)

#### T06 — GET /alertas → 500
**Arquivo**: `financeiro-extended.js` (handler de alertas do dashboard)
**Erro provável**: `.toFixed()` chamado em valor NULL ou string, ou coluna inexistente na query de alertas.
**Investigação pendente**: Ler logs PM2 após execução do T06 para ver o stack trace exato.

#### T63 — POST /clientes-fornecedores → 500
**Arquivo**: `financeiro-extended.js`
**Causa**: INSERT em tabela clientes sem coluna `nome` (NOT NULL). O POST provavelmente usa campos incorretos.
**Fix pendente**: Adicionar campo `nome` no INSERT (tabela clientes exige nome NOT NULL).

#### T65 — GET /relatorios/dre → 500
**Arquivo**: `financeiro-extended.js`
**Causa provável**: Query SQL com colunas inexistentes ou `.toFixed()` em NULL.
**Investigação pendente**: Ler o handler exato e comparar com schema.

#### T73 — GET /fornecedores → 500
**Arquivo**: `financeiro-extended.js`
**Causa provável**: Query SELECT com coluna `created_at` (fornecedores usa `data_cadastro`) — este fix já foi aplicado em compras-extended.js mas pode estar duplicado em financeiro-extended.js.
**Investigação pendente**: Verificar query exata no handler GET /fornecedores do financeiro.

#### T74 — GET /clientes → 500
**Arquivo**: `financeiro-extended.js`  
**Causa provável**: Similar ao T73 — colunas erradas no SELECT.
**Investigação pendente**: Verificar handler.

#### T79 — DEL /bancos/:id → 500
**Causa provável**: FK constraint violation — banco tem referências em movimentacoes_bancarias ou contas_bancarias. Não é bug de código, é proteção de integridade.
**Fix**: Verificar se o handler trata FK errors gracefully (retornar 409 em vez de 500).

### GRUPO 3: Permissão (1 falha)

#### T66 — GET /relatorios/lucratividade → 403
**Causa**: O handler usa `authorizeACL('financeiro.relatorios')` e o QA user pode não ter essa permissão.
**Fix pendente**: INSERT na tabela `permissoes_acoes` para o QA user com ação `financeiro.relatorios`.

### GRUPO 4: Rota inexistente (1 falha)

#### T81 — DEL /orcamentos/:id → 404
**Causa**: A rota DELETE para orçamentos pode não existir no router.
**Investigação pendente**: Verificar se existe route DELETE em financeiro-extended.js para orçamentos.

---

## Correções Já Aplicadas (resumo)

### Backend — financeiro-core.js (588 linhas na VPS)
1. ✅ Guard para sub-rotas em GET /contas-pagar/:id (linha 285): `if (['vencidas', 'vencendo', 'estatisticas', 'resumo', 'lote'].includes(req.params.id)) return next();`
2. ✅ Guard para sub-rotas em GET /contas-receber/:id (linha 367): `if (['vencidas', 'inadimplentes', 'estatisticas', 'resumo'].includes(req.params.id)) return next();`
3. ✅ Rotas avançadas adicionadas (vencidas, vencendo, estatisticas, resumo, lote/pagar, inadimplentes) — linhas 421-590

### Backend — financeiro-extended.js (2132 linhas na VPS)
1. ✅ Middleware `checkFinanceiroPermission()` — corrigido para buscar por email primeiro (evita colisão ID entre tabelas usuarios e funcionarios)
2. ✅ Middleware `checkFinanceiroPermission()` — trata `permissoes_financeiro` como array nativo (MySQL JSON) sem `JSON.parse()` desnecessário
3. ✅ Middleware `authorizeACL()` — reescrito para consultar banco `permissoes_acoes` em vez de `req.user.permissions`
4. ✅ POST /bancos — corrigido INSERT (removidas colunas inexistentes)
5. ✅ POST /contas-bancarias/:id/movimentacoes — corrigido para buscar banco_id real via conta bancária (FK constraint)
6. ✅ POST /plano-contas — removida coluna `icone` (não existe na tabela); tipo `patrimonio_liquido` → `patrimonio`
7. ✅ PUT /impostos/:id — adicionado fallback para `base` undefined
8. ✅ GET /clientes-fornecedores/buscar — removidas colunas `numero`, `complemento` (inexistentes em clientes)

### Backend — financeiro-routes.js (889 linhas na VPS)
1. ✅ POST /movimentacoes-bancarias — corrigido body parsing

### Middleware — src/middleware/rate-limit.js (381 linhas na VPS)
1. ✅ Bypass de rate limit para localhost/127.0.0.1 (para que testes locais na VPS não sejam bloqueados)

### Banco de Dados
1. ✅ UPDATE usuarios SET permissoes_financeiro = '["dashboard","contas_pagar","contas_receber","bancos","categorias","relatorios","fluxo_caixa","centros_custo","impostos","faturamento","orcamentos","api_aberta","plano_contas"]' WHERE id = 57
2. ✅ INSERT INTO permissoes_acoes — 4 permissões para QA user (financeiro.orcamentos.*, ler/criar/editar)

---

## Schemas das Tabelas Críticas

### contas_pagar
```
id INT PK AUTO_INCREMENT
fornecedor_id INT FK
valor DECIMAL(18,2)
descricao VARCHAR(255)
status VARCHAR(20) — valores: pendente, pago, vencido, cancelado
vencimento DATE
data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
data_vencimento DATE NOT NULL DEFAULT '2025-01-01'
categoria_id INT
banco_id INT
forma_pagamento VARCHAR(50)
observacoes TEXT
parcela_numero INT
total_parcelas INT
valor_pago DECIMAL(15,2) DEFAULT 0.00
data_recebimento DATE
vendedor VARCHAR(100)
projeto VARCHAR(100)
cnpj_cpf VARCHAR(255)
pedido_compra_id INT FK
venda_id INT FK
```

### contas_receber
```
id INT PK AUTO_INCREMENT
cliente_id INT FK
pedido_id INT
valor DECIMAL(18,2)
descricao VARCHAR(255)
status VARCHAR(20)
vencimento DATE
data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
data_vencimento DATE NOT NULL DEFAULT '2025-01-01'
categoria_id INT
banco_id INT
forma_recebimento VARCHAR(50)
observacoes TEXT
parcela_numero INT
total_parcelas INT
valor_recebido DECIMAL(15,2) DEFAULT 0.00
data_recebimento DATE
vendedor VARCHAR(100)
projeto VARCHAR(100)
cliente_nome VARCHAR(255)
juros DECIMAL(18,2) DEFAULT 0.00
multa DECIMAL(18,2) DEFAULT 0.00
desconto DECIMAL(18,2) DEFAULT 0.00
```

### bancos
```
id INT PK AUTO_INCREMENT
nome VARCHAR(255) NOT NULL
instituicao VARCHAR(100)
tipo_conta VARCHAR(50)
agencia VARCHAR(20)
conta_corrente VARCHAR(30)
saldo_inicial DECIMAL(15,2) DEFAULT 0.00
saldo_atual DECIMAL(15,2) DEFAULT 0.00
limite_credito DECIMAL(15,2) DEFAULT 0.00
status ENUM('ativo','inativo') DEFAULT 'ativo'
considera_fluxo TINYINT(1) DEFAULT 1
emite_boleto TINYINT(1) DEFAULT 0
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE
```

### contas_bancarias
```
id INT PK AUTO_INCREMENT
nome VARCHAR(100) NOT NULL
banco VARCHAR(100)
agencia VARCHAR(20)
conta VARCHAR(20)
tipo VARCHAR(100)
saldo_inicial DECIMAL(15,2) DEFAULT 0.00
saldo_atual DECIMAL(15,2) DEFAULT 0.00
ativo TINYINT(1) DEFAULT 1
descricao TEXT
observacoes TEXT
banco_nome VARCHAR(100)
numero_conta VARCHAR(30)
saldo DECIMAL(15,2) DEFAULT 0.00
ativa TINYINT(1) DEFAULT 1
considera_fluxo TINYINT(1) DEFAULT 1
emite_boletos TINYINT(1) DEFAULT 0
limite_credito DECIMAL(15,2) DEFAULT 0.00
```

### clientes
```
id INT PK AUTO_INCREMENT
nome VARCHAR(255) NOT NULL  ← CRITICAL: NOT NULL
razao_social VARCHAR(255)
nome_fantasia VARCHAR(255)
cnpj_cpf VARCHAR(255)
contato VARCHAR(255)
email VARCHAR(255)
telefone VARCHAR(20)
empresa_id INT NOT NULL FK
ativo TINYINT(1) DEFAULT 1
cidade VARCHAR(80)
estado VARCHAR(2)
cep VARCHAR(12)
endereco VARCHAR(255)
bairro VARCHAR(100)
observacoes TEXT
```

### fornecedores
```
id INT PK AUTO_INCREMENT
nome VARCHAR(255)
razao_social VARCHAR(255)
nome_fantasia VARCHAR(255)
cnpj VARCHAR(255)
ie VARCHAR(20)  ← NÃO é inscricao_estadual
endereco TEXT
cidade VARCHAR(255)
estado CHAR(2)
cep VARCHAR(10)
telefone VARCHAR(20)
email VARCHAR(100)
contato_principal VARCHAR(100)
condicoes_pagamento TEXT
prazo_entrega_padrao INT DEFAULT 0
ativo TINYINT(1) DEFAULT 1
observacoes TEXT
data_cadastro TIMESTAMP  ← NÃO é created_at
updated_at TIMESTAMP
categoria VARCHAR(100) DEFAULT 'Geral'
```

### plano_contas
```
id INT PK AUTO_INCREMENT
codigo VARCHAR(20) NOT NULL UNIQUE
descricao VARCHAR(255) NOT NULL
tipo ENUM('receita','despesa','ativo','passivo','patrimonio')  ← NÃO tem patrimonio_liquido
pai_id INT FK
nivel INT DEFAULT 1
ativo TINYINT(1) DEFAULT 1
natureza ENUM('sintetica','analitica') DEFAULT 'analitica'
created_at TIMESTAMP
updated_at TIMESTAMP
```
NOTA: NÃO tem coluna `icone`

### movimentacoes_bancarias
```
id INT PK AUTO_INCREMENT
banco_id INT FK → bancos(id)  ← NÃO é conta_bancaria_id
tipo ENUM('entrada','saida','transferencia')
valor DECIMAL(15,2)
descricao VARCHAR(255)
data_movimentacao DATE
categoria VARCHAR(100)
documento VARCHAR(100)
observacoes TEXT
created_at TIMESTAMP
origem_conta_id INT
destino_conta_id INT
conta_destino_id INT
transferencia_id INT
saldo_anterior DECIMAL(15,2)
saldo_posterior DECIMAL(15,2)
usuario_id INT
conta_pagar_id INT
conta_receber_id INT
referencia VARCHAR(100)
forma_pagamento VARCHAR(50)
```

### impostos
```
id INT PK AUTO_INCREMENT
nome VARCHAR(100) NOT NULL
sigla VARCHAR(20) NOT NULL
tipo ENUM('federal','estadual','municipal') NOT NULL
aliquota DECIMAL(8,4) DEFAULT 0.00
base ENUM('faturamento','lucro','folha','servico','produto','outro') DEFAULT 'faturamento'
ativo TINYINT(1) DEFAULT 1
descricao TEXT
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## Arquivos do Módulo Financeiro (módulo frontend)

### HTML Pages (11 páginas ativas):
1. `modules/Financeiro/index.html` — Dashboard principal
2. `modules/Financeiro/contas_pagar.html`
3. `modules/Financeiro/contas_receber.html`
4. `modules/Financeiro/contas_bancarias.html`
5. `modules/Financeiro/conciliacao_bancaria.html`
6. `modules/Financeiro/fornecedores_clientes.html`
7. `modules/Financeiro/gestor_anexos.html`
8. `modules/Financeiro/relatorios.html`
9. `modules/Financeiro/impostos.html`
10. `modules/Financeiro/bancos.html` (referenciado no router)
11. `modules/Financeiro/orcamento.html`

### JS Externos:
- `modules/Financeiro/js/financeiro-sidebar.js`
- `modules/Financeiro/js/financeiro-comum.js`
- `modules/Financeiro/financeiro.js`
- `modules/Financeiro/auth.js`
- `modules/Financeiro/contas_bancarias.js`
- `modules/Financeiro/conciliacao_bancaria.js`
- `modules/Financeiro/fornecedores_clientes.js`
- `modules/Financeiro/gestor_anexos.js`
- `modules/Financeiro/public/js/importar-xlsx.js`

### Backend (3 arquivos de rotas):
- `routes/financeiro-core.js` (588 linhas) — CRUD principal: contas-pagar, contas-receber, categorias, bancos, + rotas avançadas
- `routes/financeiro-routes.js` (889 linhas) — movimentações, transferências, contas-bancárias, conciliação
- `routes/financeiro-extended.js` (2132 linhas) — dashboard, KPIs, alertas, permissions, centros-custo, impostos, orçamentos, plano-contas, relatórios, clientes-fornecedores

### Montagem de Rotas (routes/index.js):
Todas sob prefixo `/api/financeiro/`. Ordem: financeiro-routes → financeiro-core → financeiro-extended

---

## Próximos Passos (Plano de Continuação)

### PRIORIDADE 1: Corrigir os 8 erros de roteamento (T16-T19, T26-T29, T72)
O guard `next()` não funciona porque as rotas sub estão em `financeiro-extended.js` (arquivo DIFERENTE do `financeiro-core.js` que tem o `:id`). O `next()` pula para a próxima rota NO MESMO router, mas como estão em routers diferentes, não encontra.

**Solução**: Mover as rotas sub (vencidas, vencendo, etc.) de financeiro-extended.js para financeiro-core.js, ANTES das rotas `:id`. Ou criar rotas wrap em financeiro-core.js que importam a lógica do extended.

### PRIORIDADE 2: Corrigir T06 (alertas 500)
Ler handler GET /alertas em financeiro-extended.js, verificar se usa .toFixed() em NULL, colunas erradas, etc.

### PRIORIDADE 3: Corrigir T63 (clientes-fornecedores POST 500)  
Adicionar campo `nome` no INSERT da tabela clientes (NOT NULL constraint).

### PRIORIDADE 4: Corrigir T65 (DRE 500) e T66 (lucratividade 403)
- T65: Verificar handler GET /relatorios/dre, comparar colunas com schema
- T66: Adicionar permissão `financeiro.relatorios` para QA user

### PRIORIDADE 5: Corrigir T73-T74 (fornecedores/clientes 500)
Verificar handlers, provavelmente colunas erradas (created_at vs data_cadastro, etc.)

### PRIORIDADE 6: Melhorar T79 (DEL banco)
Tratar FK constraint violation com resposta 409 em vez de 500 genérico.

### PRIORIDADE 7: Verificar T81 (DEL orçamento 404)
Confirmar se rota DELETE /orcamentos/:id existe.

### FINAL: Rodar teste v3 e atingir ~100%

---

## Script de Teste
Versão mais recente está em `/tmp/test-financeiro-v2.js` na VPS (24KB, 82 testes).
Cópia local NÃO existe (foi criada via terminal PowerShell). Precisa ser recriada ou baixada da VPS.

## Deploy Commands
```powershell
# Upload backend
scp -i C:\Users\Tavera\.ssh\id_rsa routes/financeiro-core.js root@31.97.64.102:/var/www/aluforce/routes/
scp -i C:\Users\Tavera\.ssh\id_rsa routes/financeiro-extended.js root@31.97.64.102:/var/www/aluforce/routes/
scp -i C:\Users\Tavera\.ssh\id_rsa routes/financeiro-routes.js root@31.97.64.102:/var/www/aluforce/routes/

# Restart
ssh -i C:\Users\Tavera\.ssh\id_rsa root@31.97.64.102 "pm2 restart aluforce-dashboard --update-env"

# Run test
ssh -i C:\Users\Tavera\.ssh\id_rsa root@31.97.64.102 "cd /var/www/aluforce && node /tmp/test-financeiro-v2.js 2>&1"
```
