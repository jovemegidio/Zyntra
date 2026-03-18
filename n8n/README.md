# 🤖 n8n — Integração com ALUFORCE ERP

## O que é o n8n?

O [n8n](https://n8n.io) é uma plataforma de automação de workflows que substitui os cron jobs hardcoded do `server.js` por **workflows visuais** com dashboard, logs, retry automático e notificações.

## 📁 Estrutura

```
n8n/
├── .env.example          # Variáveis de ambiente necessárias
├── workflows/
│   ├── 01-relatorio-vendas-diario.json          # 📊 Relatório de vendas por email (7h)
│   ├── 02-backup-banco-dados.json               # 💾 Backup DB + limpeza (2h)
│   ├── 03-contas-vencer-cobranca.json           # 💰 Cobranças do dia (8h)
│   ├── 04-estoque-critico-alerta.json           # 📦 Estoque mínimo (cada 6h)
│   ├── 05-health-check-monitoramento.json       # 🏥 Health check (cada 5min)
│   ├── 06-pedidos-atrasados-alerta.json         # 📋 Pedidos atrasados (9h)
│   ├── 07-aniversariantes-email.json            # 🎂 Aniversários RH (8h)
│   ├── 08-notificacao-relatorios-email.json     # 📧 Relatórios por email
│   ├── 09-alertas-whatsapp-multimodulo.json     # 📱 Alertas WhatsApp multi-módulo
│   ├── 10-whatsapp-alertas-automaticos-v2.json  # 📱 WhatsApp alertas v2
│   ├── 11-resumo-financeiro-diario.json         # 💵 Resumo financeiro diário
│   ├── 12-nfe-pendentes-alerta.json             # 📄 NF-e pendentes
│   ├── 13-followup-orcamentos.json              # 🔄 Follow-up de orçamentos
│   ├── 14-producao-parada-alerta.json           # ⚙️ Produção parada
│   ├── 15-relatorio-semanal-rh.json             # 👥 Relatório semanal RH
│   ├── 16-meta-vendas-alerta.json               # 🎯 Meta de vendas
│   ├── 17-conciliacao-bancaria-divergencias.json # 🏦 Divergências bancárias
│   ├── 18-escalonamento-aprovacoes.json         # ✅ Escalonamento de aprovações
│   ├── 19-entregas-atrasadas-alerta.json        # 🚚 Entregas atrasadas
│   ├── 20-faturamento-sem-nfe-alerta.json       # ⚠️ Faturamento sem NF-e
│   ├── 21-transacoes-recorrentes-auto.json      # 🔁 Transações recorrentes
│   ├── 22-boletos-vencidos-cobranca.json        # 📑 Boletos vencidos
│   ├── 23-resumo-expedicao-diario.json          # 📦 Resumo expedição diário
│   ├── 24-ponto-inconsistencias-alerta.json     # ⏰ Ponto inconsistências
│   ├── 25-ferias-vencendo-alerta.json           # 🏖️ Férias vencendo
│   ├── 26-requisicoes-compra-paradas.json       # 🛒 Requisições de compra paradas
│   ├── 27-ops-sem-material-alerta.json          # 🏭 OPs sem material
│   ├── 28-xml-contabilidade-export.json         # 📊 XML contabilidade export
│   ├── 29-fluxo-caixa-projecao-semanal.json     # 💰 Projeção fluxo de caixa
│   ├── 31-reativacao-clientes-campanha.json     # 🔄 Reativação de clientes
│   ├── 32-retornos-bancarios-processamento.json # 🏦 Retornos bancários
│   ├── 33-performance-transportadoras-mensal.json # 🚛 Performance transportadoras
│   ├── 34-cleanup-usuarios-inativos.json        # 🧹 Limpeza usuários inativos
│   ├── 35-resumo-diario-producao.json           # ⚙️ Resumo diário produção
│   └── 36-audit-anomalias-seguranca.json        # 🔒 Auditoria de segurança
```

## 🚀 Como Subir no VPS

### 1. Criar o banco do n8n no MySQL
```sql
CREATE DATABASE IF NOT EXISTS n8n CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON n8n.* TO 'aluforce'@'%';
FLUSH PRIVILEGES;
```

### 2. Configurar variáveis de ambiente
```bash
# Copiar o template e editar
cp n8n/.env.example .env.n8n

# Gerar chave de encriptação segura
openssl rand -hex 32

# Gerar API Key única
uuidgen  # ou: node -e "console.log(require('crypto').randomUUID())"
```

### 3. Subir com Docker Compose
```bash
# Subir tudo (app + n8n + mysql + redis)
docker-compose up -d

# Ou subir apenas o n8n
docker-compose up -d n8n
```

### 4. Acessar o painel
- **URL:** `http://SEU_IP:5678`
- **Login:** admin / (senha configurada em N8N_AUTH_PASSWORD)

### 5. Importar os workflows
1. Acesse `http://SEU_IP:5678`
2. Vá em **Workflows → Import from File**
3. Importe cada arquivo `.json` da pasta `n8n/workflows/`
4. **Ative** cada workflow (toggle ON)

## 🔌 API Endpoints Disponíveis

O ALUFORCE expõe os seguintes endpoints para o n8n em `/api/n8n/`:

### Consultas (GET)
| Endpoint | Descrição |
|---|---|
| `/api/n8n/status` | Status geral do sistema |
| `/api/n8n/vendas/resumo-diario` | Resumo de vendas do dia |
| `/api/n8n/financeiro/contas-vencer?dias=0&tipo=receber` | Contas a vencer |
| `/api/n8n/compras/pedidos-atrasados` | Pedidos com entrega atrasada |
| `/api/n8n/compras/fornecedores-docs-vencendo?dias=30` | Docs de fornecedores vencendo |
| `/api/n8n/compras/aprovacoes-pendentes?dias=2` | Aprovações pendentes |
| `/api/n8n/estoque/criticos` | Produtos com estoque crítico |
| `/api/n8n/rh/aniversariantes?periodo=dia` | Aniversariantes do dia/semana |
| `/api/n8n/clientes/inativos?dias=90` | Clientes para inativação |
| `/api/n8n/sql?query=SELECT...` | Query SQL customizada (somente SELECT) |

### Ações (POST)
| Endpoint | Descrição |
|---|---|
| `/api/n8n/acoes/backup-database` | Disparar backup do banco |
| `/api/n8n/acoes/inativar-clientes` | Inativar clientes sem movimentação |
| `/api/n8n/acoes/atualizar-avaliacoes-fornecedores` | Recalcular ratings |
| `/api/n8n/acoes/verificar-estoque-minimo` | Executar SP de estoque |
| `/api/n8n/acoes/marcar-lembrete-enviado` | Marcar lembretes como enviados |
| `/api/n8n/acoes/criar-notificacao-compra` | Criar notificação de compras |

### Eventos (POST — n8n → ALUFORCE)
| Endpoint | Descrição |
|---|---|
| `/api/n8n/eventos/workflow-concluido` | Notificar workflow concluído |
| `/api/n8n/eventos/alerta` | Enviar alerta para o dashboard |

### Autenticação
Todos os endpoints exigem o header:
```
X-N8N-API-Key: sua-api-key-aqui
```

## 📊 Workflows vs Cron Jobs (Migração)

| Cron Job Original (server.js) | Workflow n8n | Status |
|---|---|---|
| Relatório vendas (7h) | `01-relatorio-vendas-diario` | ✅ Criado |
| Backup DB (2h) | `02-backup-banco-dados` | ✅ Criado |
| Cobranças vencendo (8h) | `03-contas-vencer-cobranca` | ✅ Criado |
| Estoque mínimo (6h) | `04-estoque-critico-alerta` | ✅ Criado |
| Health check | `05-health-check-monitoramento` | ✅ Criado |
| Pedidos atrasados (9h) | `06-pedidos-atrasados-alerta` | ✅ Criado |
| Aniversariantes (8h) | `07-aniversariantes-email` | ✅ Criado |
| Docs fornecedores (seg 8h) | A criar no n8n | ⏳ Pendente |
| Aprovações pendentes (10h) | A criar no n8n | ⏳ Pendente |
| Rating fornecedores (dom 3h) | A criar no n8n | ⏳ Pendente |
| Inativar clientes (4h) | A criar no n8n | ⏳ Pendente |

> **Nota:** Após confirmar que os workflows n8n funcionam, comente os cron jobs correspondentes no `server.js`.

## 🔄 Serviço de Integração (services/n8n-integration.js)

O serviço `n8n-integration.js` permite disparar webhooks do ALUFORCE para o n8n:

```javascript
const { getN8nIntegration } = require('./services/n8n-integration');
const n8n = getN8nIntegration();

// Exemplos de uso nas rotas do ERP:
await n8n.onVendaCriada({ id: 123, valor: 5000, cliente_nome: 'ACME' });
await n8n.onPagamentoRecebido({ id: 456, valor: 1500 });
await n8n.onEstoqueCritico([{ nome: 'Parafuso M6', estoque: 5, minimo: 50 }]);
await n8n.onErroSistema(new Error('DB timeout'), 'vendas-routes');
await n8n.onDeploy({ versao: '2.1.8', autor: 'DevOps' });
```

## 🔒 Segurança

- Todos os endpoints n8n usam API Key (não expõem dados sem autenticação)
- O endpoint `/api/n8n/sql` aceita **somente SELECT** (INSERT/UPDATE/DELETE bloqueados)
- As rotas n8n são isentas de CSRF (comunicação server-to-server)
- O n8n roda na rede interna Docker (`aluforce-net`), não exposto externamente por padrão
