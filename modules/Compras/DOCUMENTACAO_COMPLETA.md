# 📘 DOCUMENTAÇÃO COMPLETA DO MÓDULO DE COMPRAS
## Sistema Aluforce v2.0

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Instalação](#instalação)
3. [Estrutura do Banco de Dados](#estrutura-do-banco-de-dados)
4. [APIs REST](#apis-rest)
5. [Integração com PCP](#integração-com-pcp)
6. [Workflow de Aprovações](#workflow-de-aprovações)
7. [Sistema de Notificações](#sistema-de-notificações)
8. [Cron Jobs](#cron-jobs)
9. [Frontend](#frontend)
10. [Exemplos de Uso](#exemplos-de-uso)
11. [Troubleshooting](#troubleshooting)

---

## 🎯 VISÃO GERAL

O Módulo de Compras do Aluforce é um sistema completo para gerenciamento de:

- **Fornecedores** - Cadastro, avaliação e histórico
- **Pedidos de Compra** - Criação, aprovação e rastreamento
- **Cotações** - Comparação de propostas de fornecedores
- **Recebimentos** - Conferência de materiais e integração com estoque
- **Integração PCP** - Requisições automáticas baseadas em estoque mínimo
- **Workflow** - Aprovações multinível configuráveis
- **Relatórios** - Análises gerenciais e KPIs

### Principais Características

✅ **Profissional e Completo** - Pronto para uso em produção  
✅ **Integrado** - Sincronização automática com PCP e Estoque  
✅ **Auditável** - Log completo de todas as ações  
✅ **Automatizado** - Alertas e verificações via cron jobs  
✅ **Seguro** - Autenticação JWT e controle de permissões  
✅ **Escalável** - APIs RESTful com paginação  

---

## 🚀 INSTALAÇÃO

### Pré-requisitos

- Node.js 14+
- MySQL 8.0+
- npm ou yarn

### Passo 1: Executar Script de Inicialização

```powershell
cd "c:\Users\Administrator\Pictures\Sistema - Aluforce v.2 - BETA\Sistema - Aluforce v.2 - BETA"
.\inicializar_compras.ps1
```

O script irá:
1. Verificar conexão com MySQL
2. Criar backup do banco (opcional)
3. Executar `sql/compras_estrutura_completa.sql`
4. Executar `sql/compras_integracao_pcp.sql`
5. Criar todas as tabelas, views, triggers e procedures
6. Oferecer para reiniciar o servidor

### Passo 2: Verificar Instalação

```bash
# Listar tabelas criadas
mysql -u root -p aluforce_vendas -e "SHOW TABLES LIKE '%fornec%' OR '%pedidos_compra%' OR '%cotac%'"

# Verificar configurações
mysql -u root -p aluforce_vendas -e "SELECT * FROM compras_configuracoes"
```

### Passo 3: Testar APIs

```bash
# Dashboard
curl -H "Authorization: Bearer SEU_TOKEN" http://localhost:3000/api/compras/dashboard

# Listar fornecedores
curl -H "Authorization: Bearer SEU_TOKEN" http://localhost:3000/api/compras/fornecedores
```

---

## 🗄️ ESTRUTURA DO BANCO DE DADOS

### Tabelas Principais

#### **fornecedores**
Cadastro completo de fornecedores com avaliação e performance.

```sql
CREATE TABLE fornecedores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    razao_social VARCHAR(255) NOT NULL,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    avaliacao_geral DECIMAL(3,2),
    status ENUM('ativo', 'inativo', 'bloqueado'),
    -- + 40 campos
);
```

**Campos Importantes:**
- `avaliacao_geral` - Média das avaliações (0-5)
- `total_compras` - Valor total comprado
- `total_pedidos` - Quantidade de pedidos
- `prazo_entrega_padrao` - Dias de prazo padrão

#### **pedidos_compra**
Pedidos de compra com controle de status e aprovação.

```sql
CREATE TABLE pedidos_compra (
    id INT PRIMARY KEY AUTO_INCREMENT,
    numero_pedido VARCHAR(50) UNIQUE NOT NULL,
    fornecedor_id INT NOT NULL,
    status ENUM('rascunho', 'pendente', 'aguardando_aprovacao', 
                'aprovado', 'enviado', 'parcial', 'recebido', 'cancelado'),
    prioridade ENUM('baixa', 'normal', 'alta', 'urgente'),
    valor_total DECIMAL(15,2),
    origem ENUM('manual', 'pcp', 'estoque', 'cotacao'),
    -- + 30 campos
);
```

#### **workflow_aprovacoes**
Sistema de aprovações multinível.

```sql
CREATE TABLE workflow_aprovacoes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    entidade_tipo ENUM('pedido_compra', 'cotacao'),
    entidade_id INT NOT NULL,
    nivel INT NOT NULL,
    aprovador_id INT NOT NULL,
    status ENUM('pendente', 'aprovado', 'rejeitado'),
    -- + 10 campos
);
```

### Views Úteis

#### **vw_pedidos_completos**
Pedidos com todas as informações de fornecedor e solicitante.

```sql
SELECT * FROM vw_pedidos_completos WHERE status = 'aguardando_aprovacao';
```

#### **vw_dashboard_compras**
KPIs consolidados para o dashboard.

```sql
SELECT * FROM vw_dashboard_compras;
-- Retorna: pedidos_ativos, pendentes, valor_mes, fornecedores_ativos, etc
```

#### **vw_materiais_comprar**
Materiais que precisam de compra (estoque baixo).

```sql
SELECT * FROM vw_materiais_comprar WHERE situacao IN ('critica', 'alta');
```

### Stored Procedures

#### **sp_verificar_estoque_minimo()**
Verifica estoque e cria requisições automáticas.

```sql
CALL sp_verificar_estoque_minimo();
```

#### **sp_movimentar_estoque()**
Registra movimentação de estoque com validações.

```sql
CALL sp_movimentar_estoque(
    'MAT-001',        -- codigo_material
    'entrada',        -- tipo_movimento
    'compra',         -- origem
    100,              -- quantidade
    'recebimento',    -- documento_tipo
    123,              -- documento_id
    'REC-2025-001',   -- documento_numero
    'A1-P1',          -- localizacao
    15.50,            -- custo_unitario
    1,                -- usuario_id
    'Recebimento OK', -- observacoes
    @sucesso,
    @mensagem
);
```

#### **sp_converter_requisicao_em_pedido()**
Converte requisição do PCP em pedido de compra.

```sql
CALL sp_converter_requisicao_em_pedido(
    123,              -- requisicao_id
    45,               -- fornecedor_id
    1,                -- usuario_id
    @pedido_id,
    @numero_pedido,
    @sucesso,
    @mensagem
);

SELECT @pedido_id, @numero_pedido, @sucesso, @mensagem;
```

---

## 🌐 APIs REST

### Base URL
```
http://localhost:3000/api/compras
```

### Autenticação
Todas as rotas requerem token JWT no header:
```
Authorization: Bearer SEU_TOKEN_JWT
```

---

### 📊 Dashboard

#### **GET /dashboard**
Retorna KPIs e estatísticas do módulo.

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": {
      "pedidos_ativos": 89,
      "pedidos_pendentes": 23,
      "pedidos_entregues": 156,
      "valor_mes_atual": 487320.50,
      "fornecedores_ativos": 47
    },
    "pedidosPorStatus": [...],
    "topFornecedores": [...],
    "pedidosAtrasados": [...]
  }
}
```

---

### 👥 Fornecedores

#### **GET /fornecedores**
Lista fornecedores com filtros e paginação.

**Query Parameters:**
- `search` - Busca por nome, CNPJ ou cidade
- `status` - ativo, inativo, bloqueado
- `categoria` - estrategico, preferencial, homologado
- `limit` - Itens por página (padrão: 50)
- `offset` - Paginação

**Example:**
```bash
GET /api/compras/fornecedores?search=alpha&status=ativo&limit=20
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "codigo": "FOR-00001",
      "razao_social": "Fornecedor Alpha Ltda",
      "cnpj": "12345678000190",
      "avaliacao_geral": 4.5,
      "total_pedidos": 45,
      "total_compras": 125000.00,
      "media_atraso_dias": 2.3
    }
  ],
  "pagination": {
    "total": 47,
    "limit": 20,
    "offset": 0,
    "pages": 3
  }
}
```

#### **GET /fornecedores/:id**
Detalhes completos de um fornecedor.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "razao_social": "Fornecedor Alpha Ltda",
    "contatos": [...],
    "avaliacoes": [...],
    "ultimosPedidos": [...]
  }
}
```

#### **POST /fornecedores**
Criar novo fornecedor.

**Body:**
```json
{
  "razao_social": "Nova Empresa Ltda",
  "nome_fantasia": "Nova Empresa",
  "cnpj": "12345678000190",
  "telefone": "(11) 98765-4321",
  "email": "contato@novaempresa.com",
  "cidade": "São Paulo",
  "estado": "SP",
  "cep": "01310-100",
  "categoria": "homologado",
  "contatos": [
    {
      "nome": "João Silva",
      "cargo": "Gerente Comercial",
      "telefone": "(11) 98765-4321",
      "email": "joao@novaempresa.com",
      "principal": true
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "id": 48,
  "codigo": "FOR-00048"
}
```

#### **PUT /fornecedores/:id**
Atualizar fornecedor.

#### **POST /fornecedores/:id/avaliar**
Avaliar fornecedor após recebimento.

**Body:**
```json
{
  "pedido_id": 123,
  "nota_qualidade": 5,
  "nota_prazo": 4,
  "nota_preco": 5,
  "nota_atendimento": 5,
  "comentarios": "Excelente fornecedor, materiais de qualidade",
  "recomenda_fornecedor": true
}
```

---

### 📦 Pedidos de Compra

#### **GET /pedidos**
Lista pedidos com filtros.

**Query Parameters:**
- `status` - rascunho, pendente, aguardando_aprovacao, aprovado, etc
- `data_inicio` - YYYY-MM-DD
- `data_fim` - YYYY-MM-DD
- `fornecedor_id` - ID do fornecedor
- `prioridade` - baixa, normal, alta, urgente
- `origem` - manual, pcp, estoque, cotacao
- `limit`, `offset` - Paginação

**Example:**
```bash
GET /api/compras/pedidos?status=aprovado&data_inicio=2025-01-01&data_fim=2025-12-31
```

#### **GET /pedidos/:id**
Detalhes completos de um pedido.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "numero_pedido": "PC-2025-000123",
    "fornecedor_nome": "Fornecedor Alpha Ltda",
    "status": "aprovado",
    "valor_total": 25430.50,
    "itens": [
      {
        "id": 456,
        "codigo_produto": "MAT-001",
        "descricao": "Material XYZ",
        "quantidade": 100,
        "preco_unitario": 250.00,
        "valor_total": 25000.00,
        "quantidade_recebida": 0
      }
    ],
    "aprovacoes": [...],
    "recebimentos": []
  }
}
```

#### **POST /pedidos**
Criar novo pedido de compra.

**Body:**
```json
{
  "fornecedor_id": 1,
  "data_entrega_prevista": "2025-02-15",
  "prioridade": "normal",
  "condicoes_pagamento": "30 dias",
  "prazo_entrega_dias": 15,
  "observacoes": "Urgente para OP #123",
  "frete": 150.00,
  "desconto": 500.00,
  "itens": [
    {
      "codigo_produto": "MAT-001",
      "descricao": "Material XYZ",
      "quantidade": 100,
      "unidade": "UN",
      "preco_unitario": 250.00
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "id": 124,
  "numero_pedido": "PC-2025-000124"
}
```

#### **POST /pedidos/:id/aprovar**
Aprovar ou rejeitar pedido.

**Body:**
```json
{
  "aprovar": true,
  "comentario": "Pedido aprovado. Fornecedor confiável e preço competitivo."
}
```

#### **POST /pedidos/:id/cancelar**
Cancelar pedido.

**Body:**
```json
{
  "motivo": "Pedido duplicado por engano"
}
```

---

### 💰 Cotações

#### **GET /cotacoes**
Lista cotações.

#### **POST /cotacoes**
Criar nova cotação.

**Body:**
```json
{
  "titulo": "Cotação de Materiais Q1/2025",
  "descricao": "Materiais para obras",
  "data_encerramento": "2025-01-31",
  "tipo": "preco",
  "itens": [
    {
      "codigo_produto": "MAT-001",
      "descricao": "Material XYZ",
      "quantidade": 500,
      "unidade": "UN",
      "preco_referencia": 250.00
    }
  ],
  "fornecedores": [1, 2, 3]
}
```

---

### 📥 Recebimentos

#### **POST /recebimentos**
Registrar recebimento de material.

**Body:**
```json
{
  "pedido_id": 123,
  "numero_nfe": "123456",
  "chave_nfe": "12345678901234567890123456789012345678901234",
  "data_emissao_nfe": "2025-01-15",
  "valor_nfe": 25430.50,
  "conferente": "João Silva",
  "observacoes": "Materiais em perfeito estado",
  "itens": [
    {
      "pedido_item_id": 456,
      "quantidade_pedida": 100,
      "quantidade_recebida": 100,
      "quantidade_aprovada": 100,
      "quantidade_rejeitada": 0,
      "localizacao_estoque": "A1-P1",
      "lote": "LOTE-2025-001"
    }
  ]
}
```

---

### 🔔 Notificações

#### **GET /notificacoes**
Lista notificações do usuário logado.

**Query Parameters:**
- `limit` - Número de notificações (padrão: 20)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "tipo": "pedido_aprovacao",
      "titulo": "Pedido aguardando aprovação",
      "mensagem": "O pedido PC-2025-000123 no valor de R$ 25.430,50 aguarda sua aprovação.",
      "lida": false,
      "created_at": "2025-01-15T10:30:00Z"
    }
  ],
  "nao_lidas": 5
}
```

#### **PUT /notificacoes/:id/ler**
Marcar notificação como lida.

---

### 📈 Relatórios

#### **GET /relatorios/compras-periodo**
Relatório de compras por período.

**Query Parameters:**
- `data_inicio` - YYYY-MM-DD (obrigatório)
- `data_fim` - YYYY-MM-DD (obrigatório)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "mes": "2025-01",
      "total_pedidos": 45,
      "valor_total": 487320.50,
      "fornecedores_distintos": 23,
      "ticket_medio": 10829.34,
      "pedidos_cancelados": 2
    }
  ]
}
```

#### **GET /relatorios/top-fornecedores**
Ranking de fornecedores por valor comprado.

**Query Parameters:**
- `data_inicio`, `data_fim` - Período
- `limit` - Top N (padrão: 10)

---

## 🔗 INTEGRAÇÃO COM PCP

### Fluxo Automático

1. **PCP detecta estoque baixo**
   - Cron job executa `sp_verificar_estoque_minimo()` a cada 6 horas
   - Compara `quantidade_disponivel` com `ponto_pedido`

2. **Sistema cria requisição automática**
   - Insere em `pcp_requisicoes_compra`
   - Calcula quantidade baseada em `lote_economico`
   - Define urgência baseada em `criticidade`

3. **Comprador é notificado**
   - Notificação no sistema
   - Email automático (se configurado)

4. **Comprador aprova requisição**
   - Via dashboard de Compras ou PCP
   - Status muda para `aprovada`

5. **Sistema converte em pedido**
   - Manual ou automático (configurável)
   - Usa `sp_converter_requisicao_em_pedido()`
   - Busca fornecedor preferencial

6. **Pedido segue workflow normal**
   - Aprovações necessárias
   - Envio para fornecedor
   - Rastreamento

7. **Recebimento atualiza estoque**
   - Trigger `trg_atualizar_estoque_recebimento`
   - Chama `sp_movimentar_estoque()`
   - Atualiza `estoque_saldos`

### Configurar Parâmetros de Material

```sql
INSERT INTO pcp_parametros_compra (
    codigo_material, estoque_minimo, estoque_maximo, ponto_pedido,
    lote_economico, fornecedor_preferencial_id, lead_time_dias,
    curva_abc, criticidade
) VALUES (
    'MAT-001', 50, 500, 100, 200, 1, 15, 'A', 'alta'
);
```

### Consultar Materiais com Necessidade de Compra

```sql
SELECT * FROM vw_materiais_comprar WHERE situacao IN ('critica', 'alta');
```

### Consultar Requisições Pendentes

```sql
SELECT * FROM vw_requisicoes_pendentes ORDER BY urgencia DESC, dias_para_necessidade ASC;
```

---

## ✅ WORKFLOW DE APROVAÇÕES

### Configurar Regras de Aprovação

```sql
INSERT INTO workflow_regras_aprovacao (
    nome, entidade_tipo, valor_minimo, valor_maximo, nivel, aprovador_id, ativo
) VALUES
    ('Até 5 mil - Auto-aprovado', 'pedido_compra', 0, 5000, 0, NULL, TRUE),
    ('5 mil a 20 mil - Gerente', 'pedido_compra', 5000, 20000, 1, 5, TRUE),
    ('20 mil a 50 mil - Diretor', 'pedido_compra', 20000, 50000, 2, 3, TRUE),
    ('Acima de 50 mil - Presidência', 'pedido_compra', 50000, NULL, 3, 1, TRUE);
```

### Fluxo de Aprovação

1. **Pedido é criado**
   - Sistema verifica valor total
   - Busca regras aplicáveis em `workflow_regras_aprovacao`

2. **Cria aprovações necessárias**
   - Insere registros em `workflow_aprovacoes`
   - Notifica aprovadores do nível 1

3. **Aprovador nível 1 aprova**
   - Via API `POST /pedidos/:id/aprovar`
   - Sistema notifica próximo nível

4. **Todas as aprovações concluídas**
   - Status do pedido muda para `aprovado`
   - Solicitante é notificado
   - Pedido pode ser enviado ao fornecedor

### Aprovar Programaticamente

```javascript
const response = await fetch('/api/compras/pedidos/123/aprovar', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        aprovar: true,
        comentario: 'Aprovado conforme solicitado'
    })
});
```

---

## 🔔 SISTEMA DE NOTIFICAÇÕES

### Tipos de Notificação

- `pedido_aprovacao` - Pedido aguardando sua aprovação
- `pedido_aprovado` - Seu pedido foi aprovado
- `pedido_rejeitado` - Seu pedido foi rejeitado
- `entrega_atrasada` - Pedido com entrega atrasada
- `estoque_baixo` - Material com estoque abaixo do mínimo
- `cotacao_vencimento` - Cotação próxima do vencimento
- `documentacao_vencendo` - Documentação de fornecedor vencendo
- `alerta_geral` - Alertas gerais

### Consultar Notificações

```javascript
const response = await fetch('/api/compras/notificacoes?limit=20', {
    headers: { 'Authorization': 'Bearer TOKEN' }
});

const { data, nao_lidas } = await response.json();
```

### Marcar como Lida

```javascript
await fetch('/api/compras/notificacoes/123/ler', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer TOKEN' }
});
```

### Configurar Email

```sql
UPDATE compras_configuracoes 
SET valor = 'true' 
WHERE chave = 'notificacao_email_ativo';
```

---

## ⏰ CRON JOBS

### Tarefas Agendadas

| Frequência | Horário | Tarefa | Descrição |
|------------|---------|--------|-----------|
| A cada 6h | 00:00, 06:00, 12:00, 18:00 | Verificar estoque mínimo | Cria requisições automáticas |
| Diário | 09:00 | Alertar pedidos atrasados | Notifica responsáveis |
| Semanal | Segunda 08:00 | Documentação fornecedores | Alerta sobre docs vencendo |
| Diário | 10:00 | Lembretes de aprovação | Cobra aprovações pendentes |
| Semanal | Domingo 03:00 | Atualizar avaliações | Recalcula médias de fornecedores |

### Executar Manualmente

```sql
-- Verificar estoque
CALL sp_verificar_estoque_minimo();

-- Atualizar avaliações
UPDATE fornecedores f SET ...;
```

### Desabilitar Cron Job

Edite `server.js` e comente a linha desejada:

```javascript
// cron.schedule('0 9 * * *', async () => { ... });
```

---

## 💻 FRONTEND

### Páginas Disponíveis

- `/modules/Compras/index.html` - Dashboard principal
- `/modules/Compras/dashboard-pro.html` - Dashboard executivo
- `/modules/Compras/fornecedores-new.html` - Gestão de fornecedores
- `/modules/Compras/pedidos-new.html` - Pedidos de compra
- `/modules/Compras/cotacoes-new.html` - Sistema de cotações
- `/modules/Compras/recebimento-new.html` - Recebimento de materiais
- `/modules/Compras/gestao-estoque-new.html` - Controle de estoque
- `/modules/Compras/relatorios-new.html` - Relatórios gerenciais

### Consumir APIs no Frontend

```javascript
// compras-api.js já implementado
import { listarFornecedores, criarPedido } from './compras-api.js';

// Listar fornecedores
const fornecedores = await listarFornecedores({ status: 'ativo', limit: 50 });

// Criar pedido
const pedido = await criarPedido({
    fornecedor_id: 1,
    itens: [...]
});
```

### Atualizar Dashboard

```javascript
async function carregarDashboard() {
    const response = await fetch('/api/compras/dashboard', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    
    const { data } = await response.json();
    
    document.getElementById('pedidos-ativos').textContent = data.stats.pedidos_ativos;
    document.getElementById('valor-mes').textContent = formatarMoeda(data.stats.valor_mes_atual);
    // ...
}
```

---

## 📚 EXEMPLOS DE USO

### Exemplo 1: Criar Fornecedor Completo

```javascript
const novoFornecedor = {
    razao_social: "Materiais Exemplo Ltda",
    nome_fantasia: "Exemplo Materiais",
    cnpj: "12345678000190",
    inscricao_estadual: "123456789",
    telefone: "(11) 98765-4321",
    email: "contato@exemplo.com",
    logradouro: "Rua das Flores",
    numero: "123",
    bairro: "Centro",
    cidade: "São Paulo",
    estado: "SP",
    cep: "01310-100",
    prazo_entrega_padrao: 15,
    prazo_pagamento_padrao: "30 dias",
    categoria: "homologado",
    tipo_fornecedor: "distribuidor",
    contatos: [
        {
            nome: "João Silva",
            cargo: "Gerente Comercial",
            departamento: "Vendas",
            telefone: "(11) 98765-4321",
            email: "joao@exemplo.com",
            principal: true
        }
    ]
};

const response = await fetch('/api/compras/fornecedores', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(novoFornecedor)
});

const { id, codigo } = await response.json();
console.log(`Fornecedor criado: ${codigo}`);
```

### Exemplo 2: Criar Pedido com Workflow

```javascript
const novoPedido = {
    fornecedor_id: 1,
    data_entrega_prevista: "2025-02-28",
    prioridade: "alta",
    condicoes_pagamento: "30/60 dias",
    prazo_entrega_dias: 30,
    forma_frete: "CIF",
    observacoes: "Materiais urgentes para OP #456",
    frete: 500.00,
    desconto: 1000.00,
    itens: [
        {
            codigo_produto: "MAT-001",
            descricao: "Cabo de Alumínio 10mm²",
            especificacao: "Triplex, classe AA",
            quantidade: 500,
            unidade: "M",
            preco_unitario: 12.50
        },
        {
            codigo_produto: "MAT-002",
            descricao: "Conector RJ45 CAT6",
            quantidade: 1000,
            unidade: "UN",
            preco_unitario: 3.20
        }
    ]
};

// Valor total: (500 * 12.50) + (1000 * 3.20) + 500 - 1000 = 8950.00
// Como é > 5000, vai para aprovação

const response = await fetch('/api/compras/pedidos', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(novoPedido)
});

const { id, numero_pedido } = await response.json();
// Pedido criado: PC-2025-000125
// Status: aguardando_aprovacao
```

### Exemplo 3: Aprovar Pedido

```javascript
const pedidoId = 125;

const response = await fetch(`/api/compras/pedidos/${pedidoId}/aprovar`, {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer TOKEN_DO_APROVADOR',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        aprovar: true,
        comentario: "Pedido aprovado. Fornecedor confiável, preço competitivo."
    })
});

// Sistema verifica se há mais aprovações pendentes
// Se não, status muda para 'aprovado' e solicitante é notificado
```

### Exemplo 4: Registrar Recebimento

```javascript
const recebimento = {
    pedido_id: 125,
    numero_nfe: "000123",
    serie_nfe: "1",
    chave_nfe: "35250112345678000190550010001230001234567890",
    data_emissao_nfe: "2025-02-25",
    valor_nfe: 8950.00,
    conferente: "Maria Santos",
    observacoes: "Materiais conferidos e em perfeito estado",
    itens: [
        {
            pedido_item_id: 789,
            quantidade_pedida: 500,
            quantidade_recebida: 500,
            quantidade_aprovada: 500,
            quantidade_rejeitada: 0,
            localizacao_estoque: "A1-P1-N2",
            lote: "LOTE-2025-045"
        },
        {
            pedido_item_id: 790,
            quantidade_pedida: 1000,
            quantidade_recebida: 1000,
            quantidade_aprovada: 1000,
            quantidade_rejeitada: 0,
            localizacao_estoque: "B2-P3-N1",
            lote: "LOTE-2025-046"
        }
    ]
};

const response = await fetch('/api/compras/recebimentos', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer TOKEN',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(recebimento)
});

// Trigger atualiza estoque automaticamente
// Status do pedido muda para 'recebido'
// Solicitante é notificado
```

### Exemplo 5: Relatório de Compras

```javascript
const response = await fetch('/api/compras/relatorios/compras-periodo?data_inicio=2025-01-01&data_fim=2025-12-31', {
    headers: { 'Authorization': 'Bearer TOKEN' }
});

const { data } = await response.json();

// Gerar gráfico
const labels = data.map(d => d.mes);
const valores = data.map(d => d.valor_total);

new Chart(ctx, {
    type: 'bar',
    data: {
        labels: labels,
        datasets: [{
            label: 'Valor Total Comprado',
            data: valores
        }]
    }
});
```

---

## 🔧 TROUBLESHOOTING

### Problema: Tabelas não foram criadas

**Solução:**
```powershell
# Verificar logs
cat logs/inicializacao_compras_*.log

# Executar manualmente
mysql -u root -p aluforce_vendas < sql/compras_estrutura_completa.sql
```

### Problema: APIs retornam 500

**Verificar:**
1. Server.js está rodando?
2. Rotas foram importadas?
3. Token JWT é válido?

```bash
# Ver logs do servidor
tail -f logs/server.log

# Testar rota básica
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/api/compras/dashboard
```

### Problema: Cron jobs não executam

**Verificar:**
```javascript
// No server.js, após inicialização:
initCronJobs();
```

**Executar manualmente:**
```sql
CALL sp_verificar_estoque_minimo();
```

### Problema: Notificações não chegam

**Verificar configurações de email:**
```sql
SELECT * FROM compras_configuracoes WHERE chave LIKE '%notificacao%';

UPDATE compras_configuracoes 
SET valor = 'true' 
WHERE chave = 'notificacao_email_ativo';
```

**Verificar SMTP no `.env`:**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sistema@aluforce.ind.br
SMTP_PASS=sua-senha-app
```

### Problema: Integração PCP não funciona

**Verificar tabelas:**
```sql
SHOW TABLES LIKE '%pcp%';
SHOW TABLES LIKE '%estoque%';
```

**Verificar procedures:**
```sql
SHOW PROCEDURE STATUS WHERE Db = 'aluforce_vendas';

-- Testar procedure
CALL sp_verificar_estoque_minimo();
```

**Criar parâmetros de material:**
```sql
INSERT INTO pcp_parametros_compra (codigo_material, estoque_minimo, ponto_pedido, lote_economico) 
VALUES ('MAT-001', 50, 100, 200);
```

---

## 🎯 CHECKLIST DE PRODUÇÃO

Antes de colocar em produção, verificar:

- [ ] Backup do banco de dados realizado
- [ ] Scripts SQL executados sem erros
- [ ] Todas as tabelas criadas
- [ ] Views e procedures funcionando
- [ ] APIs testadas com Postman/Insomnia
- [ ] Autenticação JWT configurada
- [ ] Permissões de usuários configuradas
- [ ] Cron jobs ativados
- [ ] SMTP configurado para emails
- [ ] Parâmetros PCP cadastrados
- [ ] Fornecedores principais cadastrados
- [ ] Regras de aprovação configuradas
- [ ] Frontend testado em navegadores principais
- [ ] Logs de erro configurados
- [ ] Monitoramento ativo

---

## 📞 SUPORTE

Para dúvidas ou problemas:

1. Consulte esta documentação
2. Verifique os logs em `logs/`
3. Teste APIs com Postman
4. Consulte código fonte em `src/routes/compras.js`

---

**Documentação gerada em:** 11/12/2025  
**Versão do sistema:** Aluforce v2.0  
**Módulo:** Compras  
**Status:** ✅ Pronto para produção
