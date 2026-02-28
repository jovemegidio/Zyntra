# 📋 ALUFORCE V.2 — Análise de Sistema e Lógica de Faturamento

> **Documento Técnico Completo**  
> **Versão:** 3.0  
> **Data:** Fevereiro 2026  
> **Sistema:** ALUFORCE — ERP Industrial/Comercial  
> **Stack:** Node.js + Express + MySQL + Socket.IO  

---

## Índice

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Máquina de Estados — Pipeline Kanban](#2-máquina-de-estados--pipeline-kanban)
3. [Faturamento Completo (100%)](#3-faturamento-completo-100)
4. [Faturamento Parcial — Meia Nota (F9)](#4-faturamento-parcial--meia-nota-f9)
5. [Motor de Cálculo de Tributos](#5-motor-de-cálculo-de-tributos)
6. [Geração de XML NF-e 4.00](#6-geração-de-xml-nf-e-400)
7. [Comunicação SEFAZ](#7-comunicação-sefaz)
8. [Certificado Digital e Assinatura XML](#8-certificado-digital-e-assinatura-xml)
9. [Integração com Estoque](#9-integração-com-estoque)
10. [Integração Financeira](#10-integração-financeira)
11. [Geração de DANFE](#11-geração-de-danfe)
12. [Gateway PIX](#12-gateway-pix)
13. [Régua de Cobrança](#13-régua-de-cobrança)
14. [Comissões de Vendas](#14-comissões-de-vendas)
15. [Dashboard e Métricas](#15-dashboard-e-métricas)
16. [Segurança e RBAC](#16-segurança-e-rbac)
17. [Auditoria e Rastreabilidade](#17-auditoria-e-rastreabilidade)
18. [Schema do Banco de Dados](#18-schema-do-banco-de-dados)
19. [Referência de APIs](#19-referência-de-apis)
20. [Problemas Conhecidos e Recomendações](#20-problemas-conhecidos-e-recomendações)
21. [🔴 REGIME TRIBUTÁRIO — Cadastro de Empresa](#21--regime-tributário--cadastro-de-empresa)
22. [🔴 REFORMA TRIBUTÁRIA — IBS e CBS](#22--reforma-tributária--ibs-e-cbs)
23. [🔴 MÓDULO CONTÁBIL-FISCAL — SPED, Sintegra e Relatórios](#23--módulo-contábil-fiscal--sped-sintegra-e-relatórios)
24. [🔴 CT-e — Conhecimento de Transporte Eletrônico](#24--ct-e--conhecimento-de-transporte-eletrônico)
25. [🟡 MD-e — Manifestação do Destinatário Eletrônica](#25--md-e--manifestação-do-destinatário-eletrônica)
26. [🔴 ENTRADA DE NOTAS FISCAIS](#26--entrada-de-notas-fiscais)
27. [🔴 CADASTRO DE PRODUTOS — Análise Fiscal](#27--cadastro-de-produtos--análise-fiscal)
28. [Roadmap de Implementação Priorizado](#28-roadmap-de-implementação-priorizado)

---

## 1. Visão Geral da Arquitetura

### 1.1 Arquitetura Modular

O ALUFORCE V.2 é um **ERP modular monolítico** onde cada módulo opera em seu próprio servidor Express:

| Módulo | Porta | Servidor | Responsabilidade |
|--------|-------|----------|------------------|
| **Vendas** | 3000 | `modules/Vendas/server.js` | Pipeline Kanban, pedidos, comissões, faturamento parcial |
| **Faturamento** | 3003 | `modules/Faturamento/server.js` | NF-e fiscal, XML, SEFAZ, DANFE, tributos |
| **NFe** | 3000* | `modules/NFe/` | Frontend de emissão, importação XML, manifestação |
| **Financeiro** | 3000* | `routes/financeiro-*.js` | Contas a pagar/receber, boletos, integrações |
| **Gateway Central** | 3000 | `server.js` (raiz) | Proxy/montagem de todos os módulos |

> *Módulos NFe e Financeiro são montados como rotas no servidor principal (porta 3000).

### 1.2 Stack Tecnológico

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                          │
│  HTML5 + CSS3 + JavaScript Vanilla + Bootstrap       │
│  SortableJS (Kanban) | Chart.js (Dashboard)          │
│  Socket.IO Client (Real-time)                        │
├─────────────────────────────────────────────────────┤
│                    BACKEND                           │
│  Node.js + Express.js                                │
│  mysql2/promise | jsonwebtoken | bcryptjs             │
│  xmlbuilder2 | node-forge | pdfkit | axios           │
│  multer | nodemailer | bull/redis | socket.io        │
├─────────────────────────────────────────────────────┤
│                  BANCO DE DADOS                      │
│  MySQL 8.0 (aluforce_vendas)                         │
├─────────────────────────────────────────────────────┤
│                SERVIÇOS EXTERNOS                     │
│  SEFAZ (NF-e 4.00) | BrasilAPI (CNPJ)               │
│  Mercado Pago / PagSeguro / EfiBank / PicPay (PIX)   │
│  SMTP (Emails) | WhatsApp (Notificações)             │
└─────────────────────────────────────────────────────┘
```

### 1.3 Comunicação entre Módulos

```
Vendas (3000)  ──HTTP POST──▶  Faturamento (3003)
       │                              │
       │  POST /api/nfe/gerar         │  POST /api/faturamento/gerar-nfe
       │  POST /api/nfe/emitir        │  POST /nfes/:id/enviar-sefaz
       │                              │
       ▼                              ▼
   MySQL (pool compartilhado)    MySQL (pool próprio)
   aluforce_vendas               aluforce_vendas
```

---

## 2. Máquina de Estados — Pipeline Kanban

### 2.1 Colunas do Kanban

| Status do Pedido | Coluna Visual | Cor | Descrição |
|------------------|---------------|-----|-----------|
| `orcamento` | Orçamento | 🔵 Azul | Proposta comercial inicial |
| `analise-credito` | Análise | 🟡 Amarelo | Análise de crédito do cliente |
| `pedido-aprovado` | Pedido | 🟢 Verde | Pedido aprovado para faturar |
| `faturar` | Pedido | 🟢 Verde | Aguardando faturamento (mesma coluna visual) |
| `faturado` | Faturado | 🟣 Roxo | NF-e emitida |
| `recibo` | Finalizado | ⚫ Cinza | Entrega confirmada, processo encerrado |

### 2.2 Transições de Status

```
                    ┌──────────────────────────────────┐
                    │          orcamento                │
                    └──────────┬───────────────────────┘
                               │
                    ┌──────────▼───────────────────────┐
                    │      analise-credito              │
                    └──────────┬───────────────────────┘
                               │
                    ┌──────────▼───────────────────────┐
                    │      pedido-aprovado              │
                    └──────┬───────────┬───────────────┘
                           │           │
              ┌────────────▼──┐   ┌────▼──────────────┐
              │    faturar    │   │  Faturamento       │
              │  (aguardando) │   │  Parcial (F9)      │
              └──────┬────────┘   └────┬──────────────┘
                     │                 │
                     │            ┌────▼──────────────┐
                     │            │    parcial         │
                     │            │  (meia nota ativa) │
                     │            └────┬──────────────┘
                     │                 │ (remessa)
              ┌──────▼─────────────────▼──────────────┐
              │           faturado                     │
              └──────────┬────────────────────────────┘
                         │
              ┌──────────▼────────────────────────────┐
              │           recibo (Finalizado)          │
              └───────────────────────────────────────┘

              ╔═══════════════════════════════════════╗
              ║  cancelado ← (qualquer status)        ║
              ║  (com estorno automático de estoque)  ║
              ╚═══════════════════════════════════════╝
```

### 2.3 Regras de Transição

| Status Atual | Transições Proibidas |
|-------------|---------------------|
| `cancelado` | Não pode ir para: `aprovado`, `faturado`, `entregue`, `faturar`, `recibo` |
| `faturado` | Não pode voltar para: `orcamento`, `analise`, `analise-credito` |
| `entregue` | Não pode voltar para: `orcamento`, `analise`, `analise-credito`, `aprovado`, `faturar` |

### 2.4 Permissões de Movimentação

| Ator | Pode mover para |
|------|-----------------|
| **Vendedor** | `orcamento`, `analise`, `analise-credito`, `cancelado` |
| **Admin/Gerente** | Todos os status (respeitando transições proibidas) |
| **Edição pós-faturamento** | Apenas `ti@aluforce.ind.br` |

---

## 3. Faturamento Completo (100%)

### 3.1 Fluxo Visual

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   Kanban     │────▶│  Gerar NF-e  │────▶│  Enviar      │────▶│ Autorizada  │
│  "Faturar"  │     │  + Tributos  │     │  SEFAZ       │     │  + DANFE    │
└─────────────┘     └──────────────┘     └──────────────┘     └──────┬──────┘
                                                                      │
                    ┌──────────────┐     ┌──────────────┐            │
                    │  Baixar      │◀────│  Integrar    │◀───────────┘
                    │  Estoque     │     │  Financeiro  │
                    └──────────────┘     └──────────────┘
```

### 3.2 Endpoint — `POST /pedidos/:id/faturar`

**Arquivo:** `modules/Vendas/server.js`

**Requisitos:**
- Pedido com status `aprovado` ou `venda_ganha`
- Pedido não cancelado
- Cliente com dados completos (CNPJ/CPF, endereço)

**Fluxo Detalhado:**

1. **Busca dados** — Pedido + itens + cliente (3 queries paralelas)
2. **Tentativa de NF-e fiscal** — `POST http://localhost:3003/api/nfe/gerar` enviando:
   - Dados do cliente (nome, CNPJ/CPF, endereço completo)
   - Lista de itens (código, descrição, NCM, quantidade, valores)
   - Natureza da operação e observações
3. **Se NF-e OK** → usa número/chave/protocolo retornados
4. **Se NF-e falhar** → gera número sequencial interno: `MAX(CAST(nf_numero AS UNSIGNED)) + 1`
5. **Atualiza pedido:**
   ```sql
   UPDATE pedidos SET 
     status = 'faturado',
     nf_numero = ?,
     data_faturamento = NOW(),
     nfe_chave = ?,
     nfe_protocolo = ?
   WHERE id = ?
   ```
6. **Registra histórico** em `pedido_historico`
7. **Cria notificação** global via Socket.IO

### 3.3 Endpoint — `POST /api/faturamento/gerar-nfe`

**Arquivo:** `modules/Faturamento/api/faturamento.js`

**Fluxo Detalhado (NF-e Fiscal):**

1. **Valida entrada** — `pedido_id` obrigatório
2. **Verifica status** — Pedido deve estar `aprovado` ou `venda_ganha`
3. **Busca pedido + itens + cliente** — 3 queries ao MySQL
4. **Valida estoque** — `VendasEstoqueIntegracaoService.verificarDisponibilidade()`
5. **Carrega configuração do emitente** — Busca dados da empresa (CNPJ, IE, endereço) do banco/env
6. **Calcula tributos por item** — Para cada item do pedido:
   ```javascript
   const tributos = CalculoTributosService.calcularTributosItem({
     valorProduto, quantidade, valorDesconto,
     ncm, cfop, origem, cst_icms, aliquota_icms,
     cst_ipi, aliquota_ipi, cst_pis, aliquota_pis,
     cst_cofins, aliquota_cofins,
     ufOrigem, ufDestino, regimeTributario
   });
   ```
7. **Calcula totais** — `CalculoTributosService.calcularTotaisNFe(itensCalculados)`
8. **Gera XML NF-e 4.00** — `XmlNFeService.gerarXML(dadosNFe)` → retorna `{ xml, chaveAcesso, idNFe }`
9. **Persiste no banco:**
   ```sql
   INSERT INTO nfe (numero, serie, chave_acesso, xml_nfe, status, ...)
   INSERT INTO nfe_itens (nfe_id, produto_id, quantidade, tributos, ...)
   ```
10. **Reserva estoque** — `VendasEstoqueIntegracaoService.reservarEstoque()`
11. **Integra financeiro** — `FinanceiroIntegracaoService.gerarContasReceber()`

### 3.4 Endpoint — `POST /nfes/:id/enviar-sefaz`

**Arquivo:** `modules/Faturamento/api/faturamento.js`

**Fluxo Detalhado:**

1. **Valida** — NF-e existe e tem XML gerado
2. **Carrega certificado** — `CertificadoService.getCertificadoPEM()` + `getChavePrivadaPEM()`
3. **Assina XML** — `CertificadoService.assinarXML(xml)` (RSA-SHA1, C14N enveloped-signature)
4. **Envia ao SEFAZ** — `SefazService.enviarNFe(xmlAssinado)` via SOAP com TLS 1.2+
5. **Tratamento de resposta:**
   - **Autorizada (cStat=100)** → Atualiza status para `autorizada`, salva protocolo
   - **Em processamento (cStat=105)** → Consulta recibo via `SefazService.consultarRecibo()`
   - **Rejeitada** → Atualiza para `rejeitada` com motivo
6. **Pós-autorização:**
   - **Baixa estoque** — `VendasEstoqueIntegracaoService.baixarEstoque(nfe_id, usuario_id)`
   - **Gera DANFE** automaticamente

### 3.5 Cancelamento — `POST /nfes/:id/cancelar`

**Regras:**
- Janela máxima: **24 horas** após autorização
- Justificativa mínima: **15 caracteres**
- Evento tipo **110111** enviado ao SEFAZ
- **RBAC:** Apenas `admin`, `gerente`, `supervisor_fiscal`

**Estornos automáticos:**
- `FinanceiroIntegracaoService.estornarContasReceber()` → Cancela parcelas abertas + boletos
- `VendasEstoqueIntegracaoService.estornarEstoque()` → Reverte movimentações de saída

---

## 4. Faturamento Parcial — Meia Nota (F9)

### 4.1 Conceito

O **faturamento parcial** (popularmente chamado **"meia nota"**) é uma operação fiscal que divide o pedido em **duas etapas distintas** com CFOPs diferentes:

| Etapa | Operação | CFOP (Intra-UF) | CFOP (Inter-UF) | Baixa Estoque? | Financeiro? |
|-------|----------|-----------------|-----------------|----------------|-------------|
| **1ª — Simples Faturamento** | Emissão NF parcial (10-50%) | **5922** | **6922** | ❌ NÃO | ✅ SIM |
| **2ª — Remessa/Entrega** | Emissão NF do restante | **5117** | **6117** | ✅ SIM | ✅ SIM |

### 4.2 Quando Usar

- Venda com **entrega futura** — cliente paga parte agora, recebe depois
- **Financiamento industrial** — faturar para liberar crédito antes da produção concluir
- **Venda consignada** — faturar percentual, ajustar na entrega
- **Pedidos de grande porte** — faturamento escalonado por etapas de produção

### 4.3 Fluxo Visual Completo

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PEDIDO APROVADO                                   │
│                    Valor Total: R$ 100.000,00                       │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
    ┌─────▼──────┐         ┌─────▼────────────────────────────────┐
    │ Faturamento│         │ Meia Nota (F9)                       │
    │ Normal     │         │ Modal: Escolher % (10-50%)           │
    │ 100%       │         │ CFOP: 5922/6922                      │
    └─────┬──────┘         └─────┬────────────────────────────────┘
          │                      │
          │               ┌──────▼────────────────────────────────┐
          │               │ ETAPA 1 — Simples Faturamento         │
          │               │                                       │
          │               │ • NF com CFOP 5922 (ou 6922)          │
          │               │ • Valor: R$ 50.000,00 (50%)           │
          │               │ • Status pedido → 'parcial'           │
          │               │ • Estoque: NÃO BAIXA                  │
          │               │ • Gera conta a receber (parcial)      │
          │               │ • INSERT pedido_faturamentos (seq=1)  │
          │               └──────┬────────────────────────────────┘
          │                      │
          │                      │ ⏳ Aguarda produção/entrega...
          │                      │
          │               ┌──────▼────────────────────────────────┐
          │               │ ETAPA 2 — Remessa/Entrega             │
          │               │                                       │
          │               │ • NF com CFOP 5117 (ou 6117)          │
          │               │ • Valor: R$ 50.000,00 (restante)      │
          │               │ • Status pedido → 'faturado'          │
          │               │ • Estoque: BAIXA TOTAL (atômico)      │
          │               │ • Gera conta a receber (restante)     │
          │               │ • INSERT pedido_faturamentos (seq=2)  │
          │               └──────┬────────────────────────────────┘
          │                      │
          └──────────┬───────────┘
                     │
          ┌──────────▼────────────────────────────────────────────┐
          │                    FATURADO                            │
          │ percentual_faturado = 100%                            │
          │ estoque_baixado = 1                                   │
          └──────────┬────────────────────────────────────────────┘
                     │
          ┌──────────▼────────────────────────────────────────────┐
          │                    RECIBO (Finalizado)                 │
          └───────────────────────────────────────────────────────┘
```

### 4.4 Campos no Banco de Dados

#### Tabela `pedidos` — Colunas de faturamento parcial

| Campo | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `tipo_faturamento` | `ENUM('normal','parcial_50','entrega_futura','consignado')` | `'normal'` | Tipo do faturamento escolhido |
| `percentual_faturado` | `DECIMAL(5,2)` | `0` | Percentual acumulado já faturado |
| `valor_faturado` | `DECIMAL(15,2)` | `0` | Valor em R$ já faturado (acumulativo) |
| `valor_pendente` | `DECIMAL(15,2)` | `0` | Valor em R$ ainda pendente |
| `estoque_baixado` | `TINYINT(1)` | `0` | Flag: estoque já foi baixado? |
| `nfe_faturamento_numero` | `VARCHAR(50)` | NULL | Número da NF da Etapa 1 |
| `nfe_faturamento_cfop` | `VARCHAR(10)` | `'5922'` | CFOP da Etapa 1 |
| `nfe_remessa_numero` | `VARCHAR(50)` | NULL | Número da NF da Etapa 2 |
| `nfe_remessa_cfop` | `VARCHAR(10)` | `'5117'` | CFOP da Etapa 2 |

#### Tabela `pedido_faturamentos` — Histórico de etapas

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INT (PK, AI) | Identificador único |
| `pedido_id` | INT (FK) | Referência ao pedido |
| `sequencia` | INT | 1 = faturamento, 2 = remessa |
| `tipo` | `ENUM('faturamento','remessa','complementar')` | Tipo da parcela |
| `percentual` | `DECIMAL(5,2)` | Percentual desta parcela |
| `valor` | `DECIMAL(15,2)` | Valor monetário desta parcela |
| `nfe_numero` | `VARCHAR(50)` | Número da NF gerada |
| `nfe_chave` | `VARCHAR(50)` | Chave de acesso 44 dígitos |
| `nfe_cfop` | `VARCHAR(10)` | CFOP utilizado |
| `nfe_status` | `ENUM('pendente','autorizada','cancelada','denegada')` | Status SEFAZ |
| `baixa_estoque` | `TINYINT(1)` | Se houve baixa nesta etapa |
| `conta_receber_id` | INT (FK) | Conta financeira gerada |
| `usuario_id` | INT | Quem executou |
| `observacoes` | TEXT | Observações livres |
| `created_at` | TIMESTAMP | Data/hora |

#### Tabela `pedido_itens` — Campo parcial

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `quantidade_parcial` | `DECIMAL(15,3)` DEFAULT `0` | Quantidade parcial já faturada do item |

### 4.5 Etapa 1 — Simples Faturamento

**Endpoint:** `POST /api/vendas/pedidos/:id/faturamento-parcial`

**Body da Requisição:**
```json
{
  "tipo_faturamento": "parcial_50",
  "percentual": 50,
  "cfop": "5922",
  "gerarNFe": false,
  "gerarFinanceiro": true,
  "observacoes": "Faturamento parcial - produção em andamento"
}
```

**Lógica Detalhada:**

1. **Validações:**
   - Pedido não pode estar cancelado
   - `percentual_faturado` atual deve ser < 100
   - Percentual informado é capado: `percentualFaturar = MIN(percentual, 100 - percentualJaFaturado)`

2. **Cálculos:**
   ```
   valorFaturar = valorTotal × percentualFaturar / 100
   novoPercentual = percentualJaFaturado + percentualFaturar
   valorPendente = valorTotal - (valorJaFaturado + valorFaturar)
   ```

3. **Geração de NF sequencial:**
   ```sql
   SELECT MAX(CAST(nfe_faturamento_numero AS UNSIGNED)) AS max_num FROM pedidos
   -- Próximo número = max_num + 1 (padStart 8 dígitos)
   ```

4. **Atualização do pedido:**
   ```sql
   UPDATE pedidos SET
     tipo_faturamento = ?,
     percentual_faturado = ?,     -- acumulado
     valor_faturado = ?,          -- acumulado
     valor_pendente = ?,
     nfe_faturamento_numero = ?,
     nfe_faturamento_cfop = ?,
     status = ?                   -- 'parcial' se < 100%, 'faturado' se = 100%
   WHERE id = ?
   ```

5. **Registro do faturamento:**
   ```sql
   INSERT INTO pedido_faturamentos
     (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, 
      baixa_estoque, usuario_id, observacoes)
   VALUES (?, 1, 'faturamento', ?, ?, ?, ?, 0, ?, ?)
   ```

6. **Integração financeira (se `gerarFinanceiro = true`):**
   ```sql
   INSERT INTO contas_receber
     (pedido_id, tipo, valor, data_vencimento, status, descricao)
   VALUES (?, 'faturamento_parcial', ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 'pendente', ?)
   ```

7. **⚠️ Estoque: NÃO É BAIXADO nesta etapa**

### 4.6 Etapa 2 — Remessa/Entrega

**Endpoint:** `POST /api/vendas/pedidos/:id/remessa-entrega`

**Body da Requisição:**
```json
{
  "cfop": "5117",
  "gerarNFe": false,
  "gerarFinanceiro": true,
  "baixarEstoque": true,
  "observacoes": "Entrega realizada - remessa completa"
}
```

**Lógica Detalhada:**

1. **Validações:**
   - `estoque_baixado` deve ser `!= 1` (evita baixa duplicada)
   - `tipo_faturamento` deve ser `!= 'normal'` (apenas pedidos com faturamento parcial)

2. **Cálculo do restante:**
   ```
   valorRestante = valorTotal - valorJaFaturado
   ```

3. **Atualização do pedido:**
   ```sql
   UPDATE pedidos SET
     percentual_faturado = 100,
     valor_faturado = valor_faturado + ?,
     valor_pendente = 0,
     estoque_baixado = 1,
     data_baixa_estoque = NOW(),
     nfe_remessa_numero = ?,
     nfe_remessa_cfop = ?,
     status = 'faturado',
     data_entrega_efetiva = NOW()
   WHERE id = ?
   ```

4. **Baixa de estoque (atômica):**
   Para cada item do pedido:
   ```sql
   -- Proteção contra estoque negativo
   UPDATE produtos SET estoque_atual = estoque_atual - ?
   WHERE id = ? AND estoque_atual >= ?
   
   -- Se affectedRows = 0: log warning (estoque insuficiente)
   
   -- Registra movimentação
   INSERT INTO estoque_movimentos
     (produto_id, tipo, quantidade, referencia, usuario_id)
   VALUES (?, 'saida', ?, 'remessa_entrega_pedido_XXX', ?)
   ```

5. **Registro do faturamento:**
   ```sql
   INSERT INTO pedido_faturamentos
     (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop,
      baixa_estoque, usuario_id, observacoes)
   VALUES (?, 2, 'remessa', ?, ?, ?, ?, 1, ?, ?)
   ```

6. **Integração financeira:**
   ```sql
   INSERT INTO contas_receber
     (pedido_id, tipo, valor, data_vencimento, status, descricao)
   VALUES (?, 'remessa_entrega', ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 'pendente', ?)
   ```

### 4.7 CFOPs Utilizados

**Endpoint:** `GET /api/vendas/faturamento/cfops`

| Operação | Intra-Estadual | Inter-Estadual | Descrição |
|----------|---------------|----------------|-----------|
| Simples Faturamento | `5922` | `6922` | Lançamento fiscal sem saída de mercadoria |
| Remessa Entrega Futura | `5117` | `6117` | Venda de mercadoria adquirida para entrega futura |
| Venda Normal | `5102` | `6102` | Venda de mercadoria adquirida ou recebida de terceiros |

**Determinação automática:** O sistema sugere o CFOP baseado na UF da empresa emitente. Se a UF é MG (sede da ALUFORCE), usa 5xxx (intra-estadual); caso contrário, 6xxx (inter-estadual).

### 4.8 Consulta de Status do Faturamento

**Endpoint:** `GET /api/vendas/pedidos/:id/faturamento-status`

**Resposta:**
```json
{
  "pedido": {
    "id": 298,
    "valor_total": 100000.00,
    "tipo_faturamento": "parcial_50",
    "percentual_faturado": 50.00,
    "valor_faturado": 50000.00,
    "valor_pendente": 50000.00,
    "estoque_baixado": 0
  },
  "faturamentos": [
    {
      "sequencia": 1,
      "tipo": "faturamento",
      "percentual": 50.00,
      "valor": 50000.00,
      "nfe_numero": "00000147",
      "nfe_cfop": "5922",
      "baixa_estoque": 0,
      "created_at": "2025-06-15T10:30:00"
    }
  ],
  "proximaAcao": "remessa",
  "cfopSugerido": "5117",
  "etapas": {
    "faturamento": { "concluido": true },
    "remessa": { "concluido": false }
  }
}
```

### 4.9 Interface do Usuário — Modal Meia Nota

**Arquivo:** `modules/Vendas/public/index.html`

O modal de faturamento parcial é acionado ao clicar no card do pedido no Kanban:

1. **Tela de escolha:**
   - ✅ Faturamento Normal (100%) → `executarFaturamentoNormal()`
   - 📊 Meia Nota (F9) → `abrirModalFaturamentoParcialKanban()`

2. **Modal Meia Nota:**
   - Botões de percentual pré-definidos: 10%, 20%, 30%, 40%, 50%
   - Campo livre para percentual customizado
   - Seletor de CFOP (5922/6922)
   - Checkbox "Gerar Conta a Receber"
   - Se o pedido já tem faturamento parcial: mostra barra de progresso + opção "Emitir Remessa"

3. **Recibo Meia Nota:**
   - Título: **"RECIBO DE ENTREGA - MEIA NOTA"**
   - Badge âmbar: "⚡ FATURAMENTO XX%"
   - Grid 3 colunas: Valor Total | Valor Faturado (XX%) | Valor Pendente
   - Observação fiscal sobre faturamento parcial

### 4.10 Listagem de Pedidos Pendentes

**Endpoint:** `GET /api/vendas/faturamento/pendentes`

Retorna pedidos onde `tipo_faturamento != 'normal'` e `percentual_faturado < 100`, permitindo identificar rapidamente quais pedidos aguardam a etapa de remessa.

---

## 5. Motor de Cálculo de Tributos

### 5.1 Classe `Decimal` — Aritmética de Precisão

**Arquivo:** `modules/Faturamento/services/calculo-tributos.service.js` (Linhas 24-120)

O sistema utiliza uma classe `Decimal` customizada baseada em `BigInt` para **eliminar erros de ponto flutuante (IEEE 754)** em cálculos monetários e tributários:

```
Fator de escala: 10^10 (10 casas decimais de precisão interna)
```

**Operações suportadas:**
- `add(other)` — Soma
- `subtract(other)` — Subtração
- `multiply(other)` — Multiplicação (com ajuste de escala)
- `divide(other)` — Divisão (com ajuste de escala)
- `round(decimals)` — Arredondamento **banker's rounding** (ABNT NBR 5891)
- Comparadores: `eq()`, `gt()`, `gte()`, `lt()`, `lte()`, `isZero()`, `isNegative()`

**Banker's Rounding (ABNT NBR 5891):**
Quando o dígito descartado é exatamente 5, arredonda para o **par mais próximo**:
- 2.5 → 2 (par)
- 3.5 → 4 (par)
- 4.5 → 4 (par)

Isso evita o viés de arredondamento "para cima" em grandes volumes de cálculos.

### 5.2 `calcularTributosItem()` — Cálculo por Item

**Assinatura:**
```javascript
CalculoTributosService.calcularTributosItem({
  valorProduto, quantidade, valorDesconto,
  ncm, cfop, origem, 
  cst_icms, aliquota_icms,
  cst_ipi, aliquota_ipi,
  cst_pis, aliquota_pis,
  cst_cofins, aliquota_cofins,
  ufOrigem, ufDestino, regimeTributario
})
```

**Fórmula da base de cálculo:**

$$vBC = (quantidade \times valorUnitário) - desconto + frete + seguro + outros$$

**Sequência de cálculo:**
1. **ICMS** → `calcularICMS()`
2. **IPI** → `calcularIPI()`
3. **PIS** → `calcularPIS()`
4. **COFINS** → `calcularCOFINS()`

### 5.3 Cálculo de ICMS

**Dois regimes suportados:**

#### Simples Nacional (CSOSN 101/102):
$$vCredICMSSN = vBC \times \frac{alíquotaCréditoSN}{100}$$

Alíquota crédito SN default: **3,95%**

#### Regime Normal:

**ICMS próprio:**
$$vICMS = vBC \times \frac{alíquotaICMS}{100}$$

**Com redução de base (se aplicável):**
$$bcReduzida = vBC \times \left(1 - \frac{percentualReducao}{100}\right)$$

**ICMS-ST (Substituição Tributária — se MVA configurado):**
$$bcST = (vBC + vIPI) \times \left(1 + \frac{MVA}{100}\right)$$
$$vICMS\_ST = (bcST \times alíquotaInterna) - ICMSPróprio$$

**DIFAL (EC 87/2015) — desde 2019, 100% para UF destino:**
$$vDIFAL = vBC \times \frac{(alíquotaInterna - alíquotaInterestadual)}{100}$$

**FCP (Fundo de Combate à Pobreza):**

| UF | FCP |
|----|-----|
| RJ | 4% |
| Maioria | 2% |

**Tabela de alíquotas interestaduais:**

| Origem → Destino | Alíquota |
|-------------------|----------|
| Sul/Sudeste → Norte/Nordeste/CO/ES | 7% |
| Demais combinações | 12% |
| Importados (Res. 13/2012) | 4% |

### 5.4 Rateio Proporcional de Frete/Seguro/Outros

**Método do maior resto** — Evita "centavos perdidos" ao distribuir valores entre itens.

### 5.5 Totais da NF-e

**`calcularTotaisNFe(itens)`** — Soma todos os 22+ campos do grupo `<ICMSTot>` usando `Decimal`:

$$vNF = vProd + vFrete + vSeg + vOutro + vIPI + vST - vDesc$$

---

## 6. Geração de XML NF-e 4.00

### 6.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/xml-nfe.service.js` (509 linhas)

**Biblioteca:** `xmlbuilder2`

**Método principal:** `XmlNFeService.gerarXML(dadosNFe)` → `{ xml, chaveAcesso, idNFe }`

### 6.2 Estrutura do XML

```xml
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe{chaveAcesso}" versao="4.00">
    <ide>...</ide>          <!-- Identificação da NF-e -->
    <emit>...</emit>        <!-- Emitente -->
    <dest>...</dest>        <!-- Destinatário -->
    <det nItem="1">         <!-- Itens (1..990) -->
      <prod>...</prod>
      <imposto>
        <vTotTrib>...</vTotTrib>
        <ICMS>...</ICMS>
        <IPI>...</IPI>
        <PIS>...</PIS>
        <COFINS>...</COFINS>
      </imposto>
    </det>
    <total>
      <ICMSTot>...</ICMSTot>  <!-- 22+ campos de totais -->
    </total>
    <transp>...</transp>    <!-- Transporte -->
    <pag>                   <!-- Pagamento (NT 2016.002) -->
      <detPag>...</detPag>
    </pag>
    <infAdic>...</infAdic>  <!-- Informações Adicionais -->
  </infNFe>
</NFe>
```

### 6.3 Seções XML — Métodos Estáticos

| Método | Seção XSD | Campos Principais |
|--------|-----------|-------------------|
| `montarIdentificacao()` | `<ide>` | cUF, natOp, mod(55), serie, nNF, dhEmi, tpAmb |
| `montarEmitente()` | `<emit>` | CNPJ, xNome, enderEmit, IE, CRT |
| `montarDestinatario()` | `<dest>` | CNPJ/CPF, xNome, enderDest, indIEDest |
| `montarItens()` | `<det>` | prod + imposto (ICMS, IPI, PIS, COFINS) |
| `montarImpostosItem()` | `<imposto>` | SN → `<ICMSSN>/<CSOSN>` ou Normal → `<ICMS>/<CST>` |
| `montarTotais()` | `<ICMSTot>` | 22+ campos de totais |
| `montarPagamento()` | `<pag>` | **Sem** `<indPag>` (NT 2016.002) |

### 6.4 Chave de Acesso (44 dígitos)

```
┌──┬────┬──────────────┬──┬───┬─────────┬─┬────────┬─┐
│cUF│AAMM│    CNPJ      │mod│ser│  nNF    │tp│  cNF   │DV│
│ 2 │ 4  │     14       │ 2 │ 3 │    9    │1 │   8    │1 │
└──┴────┴──────────────┴──┴───┴─────────┴─┴────────┴─┘
```

**DV:** Módulo 11 com pesos cíclicos 2-9.

### 6.5 Segurança do XML

- **`gerarCodigoNumerico()`** — Usa `crypto.randomBytes()` (CSPRNG), **não** `Math.random()`
- **`sanitizarTexto()`** — Remove caracteres de controle, normaliza espaços, limita a 2000 chars
- **`formatarValor()`** — Usa classe `Decimal` para formatação IEEE 754-safe

---

## 7. Comunicação SEFAZ

### 7.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/sefaz.service.js` (565 linhas)

**Protocolo:** SOAP 1.2 sobre HTTPS com TLS 1.2/1.3

### 7.2 Serviços SEFAZ Disponíveis

| Método | Serviço SEFAZ | Uso |
|--------|---------------|-----|
| `enviarNFe()` | NfeAutorizacao4 | Envio de NF-e para autorização |
| `consultarRecibo()` | NfeRetAutorizacao4 | Consulta de recibo (processamento assíncrono) |
| `consultarNFe()` | NfeConsultaProtocolo4 | Consulta status de NF-e por chave |
| `cancelarNFe()` | RecepcaoEvento (110111) | Cancelamento |
| `cartaCorrecao()` | RecepcaoEvento (110110) | Carta de correção |
| `inutilizarNumeracao()` | NfeInutilizacao4 | Inutilização de faixa de numeração |
| `statusServico()` | NfeStatusServico4 | Verificação de disponibilidade |

### 7.3 Retry com Backoff Exponencial

```
Tentativa 1: imediata
Tentativa 2: delay = 2s × 2^1 = 4s (cap: 30s)
Tentativa 3: delay = 2s × 2^2 = 8s (cap: 30s)
```

- Máximo: **3 tentativas**
- Base delay: **2 segundos**
- Delay máximo: **30 segundos**
- Timeout configurável por requisição

### 7.4 Autorizadores SEFAZ

O sistema suporta **todos os 27 estados brasileiros** mapeados para seus respectivos autorizadores:

| Autorizador | Estados Atendidos | URLs |
|-------------|-------------------|------|
| **SP** | SP | Homologação + Produção |
| **MG** | MG | Homologação + Produção |
| **AM** | AM | Homologação + Produção |
| **BA** | BA | Homologação + Produção |
| **CE** | CE | Homologação + Produção |
| **GO** | GO | Homologação + Produção |
| **MS** | MS | Homologação + Produção |
| **MT** | MT | Homologação + Produção |
| **PE** | PE | Homologação + Produção |
| **PR** | PR | Homologação + Produção |
| **RS** | RS | Homologação + Produção |
| **SVAN** | MA, PA | Homologação + Produção |
| **SVRS** | AC, AL, AP, DF, ES, PB, PI, RJ, RN, RO, RR, SC, SE, TO | Homologação + Produção |

**Configuração:** `modules/Faturamento/config/nfe.config.js`

---

## 8. Certificado Digital e Assinatura XML

### 8.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/certificado.service.js`

**Tipo:** A1 (arquivo PFX/P12)  
**Biblioteca:** `node-forge`

### 8.2 Funcionalidades

| Método | Descrição |
|--------|-----------|
| `carregar(pfxBuffer, senha)` | Extrai certificado + chave privada do PFX |
| `assinarXML(xml)` | Assinatura digital RSA-SHA1 com C14N enveloped-signature |
| `validar()` | Verifica validade (data de expiração) |
| `getCertificadoPEM()` | Retorna certificado em formato PEM (base64) |
| `getChavePrivadaPEM()` | Retorna chave privada em formato PEM |

### 8.3 Upload de Certificado

**Endpoint:** `POST /api/faturamento/certificado/upload` (RBAC: `admin` only)

- Upload via `multer` (form-data)
- Proteção contra path traversal
- Validação de formato PFX/P12
- Verificação de data de validade

### 8.4 Processo de Assinatura

```
XML Original
    │
    ▼
Canonicalização (C14N)
    │
    ▼
Hash SHA-1 do <infNFe>
    │
    ▼
Assinatura RSA com chave privada
    │
    ▼
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
  <SignedInfo>
    <CanonicalizationMethod Algorithm="..."/>
    <SignatureMethod Algorithm="RSA-SHA1"/>
    <Reference URI="#NFe{chaveAcesso}">
      <Transforms>
        <Transform Algorithm="enveloped-signature"/>
        <Transform Algorithm="C14N"/>
      </Transforms>
      <DigestMethod Algorithm="SHA-1"/>
      <DigestValue>{hash}</DigestValue>
    </Reference>
  </SignedInfo>
  <SignatureValue>{assinatura}</SignatureValue>
  <KeyInfo>
    <X509Data>
      <X509Certificate>{certificado_base64}</X509Certificate>
    </X509Data>
  </KeyInfo>
</Signature>
```

---

## 9. Integração com Estoque

### 9.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/vendas-estoque-integracao.service.js` (536 linhas)

### 9.2 Fluxo de Estoque por Tipo de Faturamento

| Operação | Método | Tabela Afetada | Efeito |
|----------|--------|----------------|--------|
| Verificar disponibilidade | `verificarDisponibilidade()` | `produtos` | Leitura — confere `estoque_atual >= solicitado` |
| Reservar estoque | `reservarEstoque()` | `estoque_reservas` + `produtos` | Incrementa `quantidade_reservada` |
| Baixar estoque | `baixarEstoque()` | `estoque_movimentos` + `produtos` | Decrementa `estoque_atual`, libera reservas |
| Estornar estoque | `estornarEstoque()` | `estoque_movimentos` + `produtos` | Reverte saídas, restaura `estoque_atual` |
| Verificar saldo parcial | `verificarSaldoFaturamento()` | `pedido_itens` ↔ `nfe_itens` | JOIN para qtd já faturada por produto |
| Rastrear lotes | `rastrearLotes()` | `rastreabilidade` | Rastreio de lotes por NF-e |

### 9.3 Proteção Contra Estoque Negativo

Na remessa (Etapa 2 da meia nota):
```sql
UPDATE produtos SET estoque_atual = estoque_atual - ?
WHERE id = ? AND estoque_atual >= ?
```

Se `affectedRows = 0` → loga warning, mas **não aborta** a operação (degradação graceful).

### 9.4 Estorno ao Cancelar

Quando um pedido `faturado` é movido para `cancelado` no Kanban:

1. Busca movimentações de saída em `estoque_movimentacoes` para o pedido
2. Para cada movimentação: reverte o `estoque_atual` do produto
3. Insere movimentação de `entrada` com `documento_tipo = 'pedido_cancelado'`
4. **Fallback:** Se não encontrar movimentações, busca `pedido_itens` e reverte por SKU/código

---

## 10. Integração Financeira

### 10.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/financeiro-integracao.service.js`

### 10.2 Geração de Contas a Receber

**Método:** `gerarContasReceber(nfe_id)`

1. Busca NF-e + itens + cliente
2. Cria registro em `contas_receber` (status `pendente`)
3. Gera parcelas em `contas_receber_parcelas`
4. Vincula NF-e à conta

### 10.3 Parcelamento

**Método:** `calcularParcelas(valorTotal, condicaoPagamento)`

- Divide `valorTotal / numeroParcelas`
- **Última parcela absorve centavos** restantes (evita perda de centavos)
- Vencimentos calculados por intervalo configurável (default: 30 dias entre parcelas)

### 10.4 Atualização de Juros/Multa

- **Multa por atraso:** 1%
- **Mora diária:** 0,1% por dia
- Auto-fecha conta quando todas as parcelas são pagas

### 10.5 Geração de Boleto

**Método:** `gerarBoleto(conta_receber_id)`

- Código de barras com módulo 11
- Salva em tabela `financeiro_boletos`

### 10.6 Estorno Financeiro

**Método:** `estornarContasReceber(nfe_id)`

- Cancela todas as parcelas abertas
- Cancela conta principal
- Cancela boletos associados

### 10.7 Faturamento Parcial → Financeiro

| Etapa | Tipo da Conta | Valor | Vencimento |
|-------|---------------|-------|------------|
| 1ª (Faturamento) | `faturamento_parcial` | `valorTotal × percentual%` | +30 dias |
| 2ª (Remessa) | `remessa_entrega` | `valorTotal - valorJáFaturado` | +30 dias |

---

## 11. Geração de DANFE

### 11.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/danfe.service.js` (547 linhas)

**Biblioteca:** PDFKit + QRCode + JsBarcode

### 11.2 Seções do DANFE

| Seção | Conteúdo |
|-------|----------|
| Cabeçalho | Logo da empresa, dados do emitente, caixa DANFE, QR Code, chave de acesso em barcode |
| Destinatário | Razão social, CNPJ/CPF, endereço completo, IE |
| Itens | Tabela: Código, Descrição, NCM, CST, CFOP, UN, Qtd, V.Unit, V.Total, BC ICMS, V.ICMS, V.IPI |
| Tributos | Totais de cada tributo (ICMS, IPI, PIS, COFINS, etc.) |
| Transporte | Transportadora, placa, volumes, peso |
| Dados Adicionais | Informações complementares, informações do fisco |
| Rodapé | Data/hora de impressão, paginação |

### 11.3 Endpoint

`GET /api/faturamento/nfes/:id/danfe` → PDF binário

---

## 12. Gateway PIX

### 12.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/pix-gateway.service.js` (848 linhas)

### 12.2 Provedores Suportados

| Provedor | Status | Funcionalidades |
|----------|--------|-----------------|
| Mercado Pago | ✅ Ativo | Cobrança, QR Code, Webhook |
| PagSeguro | ✅ Ativo | Cobrança, QR Code, Webhook |
| Gerencianet/EfiBank | ✅ Ativo | Cobrança, QR Code, Webhook |
| PicPay | ✅ Ativo | Cobrança, QR Code, Webhook |

### 12.3 Tabelas

| Tabela | Descrição |
|--------|-----------|
| `pix_config` | Configuração por provedor (chaves, tokens) |
| `pix_cobrancas` | Cobranças PIX emitidas |
| `pix_webhooks` | Callbacks de pagamento |

### 12.4 Webhook

- Endpoint público com validação **HMAC**
- Rate limiting: **5 requisições/minuto por IP**

---

## 13. Régua de Cobrança

### 13.1 Visão Geral

**Arquivo:** `modules/Faturamento/services/regua-cobranca.service.js` (611 linhas)

### 13.2 Schedule Padrão

| Momento | Ação |
|---------|------|
| **-7 dias** | Lembrete por email |
| **-3 dias** | Lembrete por email + WhatsApp |
| **-1 dia** | Lembrete urgente |
| **+1 dia** | Aviso de atraso |
| **+3 dias** | Cobrança |
| **+7 dias** | Cobrança + PIX automático |
| **+15 dias** | Cobrança formal |
| **+30 dias** | Cobrança final |

### 13.3 Canais

| Canal | Tecnologia |
|-------|-----------|
| Email | SMTP via Nodemailer |
| WhatsApp | Integração WhatsApp Service |
| PIX | Cobrança automática via Gateway |

### 13.4 Templates

Variáveis disponíveis: `{{nome_cliente}}`, `{{valor_parcela}}`, `{{data_vencimento}}`, `{{dias_atraso}}`, `{{link_boleto}}`, `{{link_pix}}`

---

## 14. Comissões de Vendas

### 14.1 Configuração

| Campo em `usuarios` | Tipo | Default |
|---------------------|------|---------|
| `comissao_percentual` | `DECIMAL(5,2)` | 1.0 (1%) |
| `comissao_tipo` | `VARCHAR` | `'percentual'` |

### 14.2 Cálculo

$$\text{valor\_comissao} = \frac{\text{valor\_pedido} \times \text{comissao\_percentual}}{100}$$

**Filtro:** Apenas pedidos com `status IN ('faturado', 'recibo')` geram comissão.

### 14.3 Endpoints

| Endpoint | Descrição |
|----------|-----------|
| `GET /comissoes/configuracao` | Lista vendedores com percentuais |
| `PUT /comissoes/configuracao/:vendedorId` | Altera percentual (restrito) |
| `GET /comissoes/detalhado` | Lista por pedido |
| `GET /comissoes/resumo` | Agregado por vendedor |
| `GET /comissoes/historico` | Mensal |
| `GET /comissoes/exportar` | CSV (UTF-8 BOM) |

### 14.4 Acesso Admin

Usuários autorizados a gerenciar comissões: `ti`, `douglas`, `andreia`, `fernando`, `consultoria`, `admin`, `antonio`, `tialuforce`

---

## 15. Dashboard e Métricas

### 15.1 Dashboard Admin

| Métrica | Fonte |
|---------|-------|
| Total de pedidos faturados | `COUNT(CASE WHEN status IN ('faturado','recibo'))` |
| Valor total faturado | `SUM(valor) WHERE status IN ('faturado','recibo')` |
| Total de orçamentos | `COUNT(*)` |
| Ticket médio | `totalFaturado / totalFaturados` |
| Taxa de conversão | `(totalFaturado / totalOrcamentos) × 100` |
| Faturamento mensal (12 meses) | Agrupado por `MONTH(data_faturamento)` |
| Top vendedores | Agrupado por `vendedor`, ordenado por valor |
| Top clientes | Agrupado por `cliente`, ordenado por valor |

### 15.2 Dashboard Vendedor

Métricas pessoais (mesmo formato do admin, filtrado por `vendedor_id`) **+ meta de vendas:**

```javascript
{
  valor: meta.valor,
  atingido: valorFaturado,
  percentual: (valorFaturado / meta.valor) * 100
}
```

Fonte: tabela `metas_vendas`

### 15.3 Cache

Background job pre-computa agregados e salva em `dashboard_aggregates` (faturamento mensal, top vendedores).

---

## 16. Segurança e RBAC

### 16.1 Autenticação

- **JWT** via cookie `aluforce_token`
- Middleware `authenticateToken` em todas as rotas protegidas
- `bcryptjs` para hash de senhas

### 16.2 Controle de Acesso por Funcionalidade

| Funcionalidade | Roles Permitidos |
|----------------|-----------------|
| Gerar NF-e | `admin`, `gerente`, `faturista`, `fiscal`, `vendedor` |
| Enviar SEFAZ | `admin`, `gerente`, `faturista`, `fiscal` |
| Cancelar NF-e | `admin`, `gerente`, `supervisor_fiscal` |
| Consultar NF-e | `admin`, `gerente`, `faturista`, `fiscal`, `vendedor`, `contador` |
| Inutilizar numeração | `admin`, `gerente_fiscal`, `contador` |
| Upload certificado | `admin` |
| Editar pedido faturado | `ti@aluforce.ind.br` (hardcoded) |
| Gerenciar comissões | Lista específica de usuários |
| Financeiro | Middleware específico por role |

### 16.3 LGPD

- `lgpd-crypto.js` para criptografia de campos PII (dados pessoais)
- Campos sensíveis criptografados no banco

---

## 17. Auditoria e Rastreabilidade

### 17.1 Pontos de Auditoria

| Local | Mecanismo | Detalhes |
|-------|-----------|----------|
| Itens do pedido (POST/PUT/DELETE) | `pedido_historico` | Ação, dados anteriores/novos |
| Faturamento parcial/remessa | `pedido_historico` | JSON com metadados da operação |
| Financeiro (CRUD) | `auditoria_logs` | Usuário, ação, timestamp |
| NF-e (CRUD) | `nfe_eventos` | Todos os eventos do ciclo de vida |
| Estoque | `estoque_movimentos` / `estoque_movimentacoes` | Tipo, quantidade, referência |

### 17.2 Endpoints de Auditoria

- `POST /audit-trail` — Registra evento de auditoria
- `GET /audit-trail` — Consulta trail (ACL: `ver_auditoria`)

---

## 18. Schema do Banco de Dados

### 18.1 Tabelas Principais

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MÓDULO VENDAS                                │
├─────────────────────────────────────────────────────────────────────┤
│ pedidos              │ ~50+ campos, inclui campos de fat. parcial  │
│ pedido_itens         │ Itens do pedido + quantidade_parcial         │
│ pedido_anexos        │ Arquivos anexados (multer)                   │
│ pedido_historico     │ Auditoria de ações                           │
│ pedido_faturamentos  │ Etapas do faturamento parcial                │
│ clientes             │ Cadastro de clientes                         │
│ empresas             │ Cadastro de empresas                         │
│ usuarios             │ Usuários + comissao_percentual                │
│ metas_vendas         │ Metas mensais por vendedor                   │
│ dashboard_aggregates │ Cache de agregados                           │
│ produtos             │ Catálogo + estoque_atual                     │
│ notificacoes         │ Sistema de notificações                      │
├─────────────────────────────────────────────────────────────────────┤
│                      MÓDULO FATURAMENTO                             │
├─────────────────────────────────────────────────────────────────────┤
│ nfe                  │ NF-e emitidas (87 colunas)                   │
│ nfe_itens            │ Itens da NF-e com tributos detalhados        │
│ nfe_eventos          │ Eventos do ciclo de vida                     │
│ nfe_inutilizacoes    │ Faixas de numeração inutilizadas             │
│ configuracoes        │ Config gerais do módulo                      │
├─────────────────────────────────────────────────────────────────────┤
│                      MÓDULO FINANCEIRO                              │
├─────────────────────────────────────────────────────────────────────┤
│ contas_receber       │ Contas a receber                             │
│ contas_receber_parc. │ Parcelas das contas                          │
│ contas_pagar         │ Contas a pagar                               │
│ financeiro_boletos   │ Boletos gerados                              │
│ categorias_financ.   │ Categorias do financeiro                     │
│ auditoria_logs       │ Trail de auditoria                           │
├─────────────────────────────────────────────────────────────────────┤
│                      MÓDULO ESTOQUE                                 │
├─────────────────────────────────────────────────────────────────────┤
│ estoque_movimentos   │ Movimentações (entrada/saída)                │
│ estoque_movimentaçõ. │ Movimentações (tabela legada)                │
│ estoque_reservas     │ Reservas de estoque                          │
│ rastreabilidade      │ Rastreio de lotes                            │
├─────────────────────────────────────────────────────────────────────┤
│                      MÓDULO PIX                                     │
├─────────────────────────────────────────────────────────────────────┤
│ pix_config           │ Configuração por provedor                    │
│ pix_cobrancas        │ Cobranças PIX emitidas                       │
│ pix_webhooks         │ Callbacks de pagamento                       │
├─────────────────────────────────────────────────────────────────────┤
│                      RÉGUA DE COBRANÇA                              │
├─────────────────────────────────────────────────────────────────────┤
│ regua_cobranca_conf. │ Configuração da régua                        │
│ regua_cobranca_temp. │ Templates de mensagens                       │
│ regua_cobranca_hist. │ Histórico de envios                          │
│ regua_cobranca_fila  │ Fila de envios pendentes                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 18.2 Campos-chave da Tabela `pedidos` (relevantes ao faturamento)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INT (PK, AI) | ID do pedido |
| `status` | VARCHAR | Status atual (orcamento, parcial, faturado, etc.) |
| `valor` | DECIMAL(15,2) | Valor total do pedido |
| `nf_numero` | VARCHAR | Número da NF (faturamento normal) |
| `nfe_chave` | VARCHAR(44) | Chave de acesso da NF-e |
| `nfe_protocolo` | VARCHAR | Protocolo de autorização SEFAZ |
| `data_faturamento` | DATETIME | Data/hora do faturamento |
| `tipo_faturamento` | ENUM | normal, parcial_50, entrega_futura, consignado |
| `percentual_faturado` | DECIMAL(5,2) | % acumulado faturado |
| `valor_faturado` | DECIMAL(15,2) | R$ acumulado faturado |
| `valor_pendente` | DECIMAL(15,2) | R$ pendente |
| `estoque_baixado` | TINYINT(1) | Flag de baixa de estoque |
| `nfe_faturamento_numero` | VARCHAR(50) | NF da Etapa 1 (parcial) |
| `nfe_faturamento_cfop` | VARCHAR(10) | CFOP da Etapa 1 |
| `nfe_remessa_numero` | VARCHAR(50) | NF da Etapa 2 (remessa) |
| `nfe_remessa_cfop` | VARCHAR(10) | CFOP da Etapa 2 |
| `data_entrega_efetiva` | DATETIME | Data da entrega real |
| `data_baixa_estoque` | DATETIME | Data da baixa de estoque |
| `vendedor_id` | INT (FK) | Vendedor responsável |
| `cliente_id` | INT (FK) | Cliente do pedido |

---

## 19. Referência de APIs

### 19.1 Vendas — Faturamento

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/vendas/pedidos/:id/faturar` | Faturamento completo (100%) |
| POST | `/api/vendas/pedidos/:id/faturamento-parcial` | Etapa 1 — Meia Nota |
| POST | `/api/vendas/pedidos/:id/remessa-entrega` | Etapa 2 — Remessa |
| GET | `/api/vendas/pedidos/:id/faturamento-status` | Status do faturamento |
| GET | `/api/vendas/faturamento/pendentes` | Pedidos com faturamento parcial pendente |
| GET | `/api/vendas/faturamento/cfops` | CFOPs disponíveis |

### 19.2 Faturamento — NF-e

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/faturamento/gerar-nfe` | Gerar NF-e com tributos + XML |
| POST | `/api/faturamento/nfes/:id/enviar-sefaz` | Enviar para SEFAZ |
| POST | `/api/faturamento/nfes/:id/cancelar` | Cancelar NF-e |
| POST | `/api/faturamento/nfes/:id/carta-correcao` | Carta de correção |
| POST | `/api/faturamento/nfes/:id/inutilizar` | Inutilizar numeração |
| GET | `/api/faturamento/nfes/:id/danfe` | Gerar DANFE (PDF) |
| GET | `/api/faturamento/nfes` | Listar NF-e |
| GET | `/api/faturamento/nfes/:id` | Detalhes da NF-e |
| GET | `/api/faturamento/status-servico` | Status do SEFAZ |
| POST | `/api/faturamento/certificado/upload` | Upload de certificado A1 |
| GET | `/api/faturamento/certificado/validade` | Verificar validade |

### 19.3 NFe — Importação e Manifestação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/nfe/importar` | Importar XML de NF-e |
| POST | `/api/nfe/importar-lote` | Importar lote (até 50) |
| GET | `/api/nfe/listar` | Listar NF-e importadas |
| GET | `/api/nfe/:chave` | Detalhes por chave |
| POST | `/api/nfe/manifestacao/confirmar` | Confirmação (210200) |
| POST | `/api/nfe/manifestacao/ciencia` | Ciência (210210) |
| POST | `/api/nfe/manifestacao/desconhecer` | Desconhecimento (210220) |
| POST | `/api/nfe/manifestacao/nao-realizada` | Não realizada (210240) |

### 19.4 Financeiro

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/integracao/vendas/venda-ganha` | Integrar venda ganha |
| POST | `/integracao/estoque/nf-compra` | Integrar NF de compra |
| GET | `/contas-receber` | Listar contas a receber |
| GET | `/contas-pagar` | Listar contas a pagar |
| POST | `/audit-trail` | Registrar auditoria |

### 19.5 PIX

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/faturamento/pix/provedores` | Listar provedores |
| POST | `/api/faturamento/pix/config` | Configurar provedor |
| POST | `/api/faturamento/pix/cobranca` | Criar cobrança |
| POST | `/api/faturamento/pix/webhook` | Webhook de pagamento |

---

## 20. Problemas Conhecidos e Recomendações

### 20.1 Problemas Identificados

| # | Severidade | Problema | Localização | Impacto |
|---|-----------|----------|-------------|---------|
| 1 | 🔴 Crítico | **Regime tributário ausente** — Não existe campo `regime_tributario` em nenhuma tabela. Defaults conflitantes: PHP assume CRT=3, JS assume 'simples'. | Tabelas `empresa_config` + `configuracoes_empresa` | NF-e com tributos errados |
| 2 | 🔴 Crítico | **Campos fiscais ausentes no cadastro de produtos** — Faltam CFOP, CST, CSOSN, origem, alíquotas PIS/COFINS/IPI, CEST, pesos. | Tabela `produtos` | NF-e com dados incompletos |
| 3 | 🔴 Crítico | **IBS/CBS não implementados (NT 2025.002)** — Campo `cClassTrib` e grupos `<IBS>`, `<CBS>` ausentes do XML. SEFAZ já rejeita NF-e de LR/LP sem esses campos. | `xml-nfe.service.js` + `calculo-tributos.service.js` | NF-e REJEITADA pela SEFAZ |
| 4 | 🔴 Crítico | **Módulo contábil-fiscal inexistente** — Sem SPED Fiscal, SPED Contribuições, Sintegra, livros fiscais. | Sistema inteiro | Não-compliance com obrigações acessórias |
| 5 | 🔴 Crítico | **CT-e não implementado** — Zero suporte a Conhecimento de Transporte, essencial para indústria. | Sistema inteiro | SPED Fiscal Bloco D incompleto |
| 6 | 🔴 Crítico | **NF de entrada incompleta** — Importação salva em JSON files, sem escrituração, sem créditos, sem banco de dados. | `modules/NFe/api/nfe-importacao.js` | Sem controle fiscal de entradas |
| 7 | 🔴 Crítico | **MD-e não transmite para SEFAZ** — XML gerado mas protocolo é simulado. | `modules/NFe/api/manifestacao-destinatario.js` | Manifestação não efetiva |
| 8 | 🔴 Crítico | **Duas sequências de NF paralelas** — Vendas gera NF via `MAX(nfe_faturamento_numero)` e Faturamento tem sequência própria. | `modules/Vendas/server.js` + `modules/Faturamento/api/faturamento.js` | Duplicidade de número fiscal |
| 9 | 🔴 Crítico | **Race condition na numeração** — `SELECT MAX() → INSERT` sem lock/transaction. | `modules/Vendas/server.js` | Duplicidade sob concorrência |
| 10 | 🟡 Médio | **Aritmética float no faturamento parcial** — Usa `parseFloat()` em vez de `Decimal`. | `modules/Vendas/server.js` | Centavos perdidos |
| 11 | 🟡 Médio | **Estoque negativo aceito** — Proteção atômica loga warning mas completa remessa. | `modules/Vendas/server.js` (remessa) | Estoque inconsistente |
| 12 | 🟡 Médio | **Meia nota sem NF-e fiscal real** — `gerarNFe: false` por default. | `modules/Vendas/server.js` | Compliance fiscal parcial |
| 13 | 🟢 Baixo | **Permissão hardcoded** — Edição pós-faturamento restrita a `ti@aluforce.ind.br` por string. | `modules/Vendas/server.js` | Manutenibilidade |

### 20.2 Recomendações

1. **Unificar sequência de NF** — Criar tabela `sequencia_nf` com lock `SELECT ... FOR UPDATE` para garantir unicidade e atomicidade.

2. **Integrar meia nota com NF-e fiscal** — Quando `gerarNFe = true`, chamar o módulo Faturamento (porta 3003) para gerar XML real com CFOP 5922/6922 e enviar ao SEFAZ.

3. **Usar classe `Decimal`** nos cálculos do faturamento parcial para evitar erros de arredondamento IEEE 754.

4. **Bloquear remessa sem estoque** — Opcionalmente, abortar a operação (em vez de degradar gracefully) quando estoque insuficiente.

5. **Migrar permissão hardcoded** para role RBAC (`editar_pedido_faturado`).

6. **Adicionar transação MySQL** (`BEGIN/COMMIT/ROLLBACK`) em endpoints de faturamento parcial e remessa para garantir consistência.

---

## Apêndice A — Diagrama de Fluxo de Dados Completo

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           CICLO DE VIDA DO PEDIDO                          │
└────────────────────────────────────────────────────────────────────────────┘

  CLIENTE                    VENDEDOR                    SISTEMA
    │                           │                           │
    │  Solicita orçamento       │                           │
    ├──────────────────────────▶│                           │
    │                           │  Cria pedido (status:     │
    │                           │  orcamento)               │
    │                           ├──────────────────────────▶│
    │                           │                           │ INSERT pedidos
    │                           │                           │ INSERT pedido_itens
    │                           │                           │
    │  Aprova orçamento         │                           │
    ├──────────────────────────▶│                           │
    │                           │  Move para análise        │
    │                           ├──────────────────────────▶│
    │                           │                           │ UPDATE status
    │                           │                           │ → analise-credito
    │                           │                           │
    │                        ADMIN/GERENTE                  │
    │                           │                           │
    │                           │  Aprova crédito           │
    │                           ├──────────────────────────▶│
    │                           │                           │ UPDATE status
    │                           │                           │ → pedido-aprovado
    │                           │                           │
    │                           │                           │
    │                    ┌──────┴──────┐                    │
    │                    │  DECISÃO    │                    │
    │                    │  Tipo Fat.  │                    │
    │                    └──┬──────┬───┘                    │
    │                       │      │                        │
    │              Normal   │      │  Meia Nota             │
    │              (100%)   │      │  (Parcial)             │
    │                       │      │                        │
    │                       ▼      ▼                        │
    │         ┌─────────────────┐ ┌────────────────────┐   │
    │         │  POST /faturar  │ │POST /fat-parcial   │   │
    │         │  Gera NF 100%   │ │CFOP 5922, X%       │   │
    │         │  Baixa estoque  │ │NÃO baixa estoque   │   │
    │         │  Gera financeiro│ │Gera financeiro X%   │   │
    │         └────────┬────────┘ └──────┬─────────────┘   │
    │                  │                 │                   │
    │                  │            ⏳ Produção...           │
    │                  │                 │                   │
    │                  │         ┌───────▼──────────────┐   │
    │                  │         │POST /remessa-entrega │   │
    │                  │         │CFOP 5117, restante   │   │
    │                  │         │BAIXA estoque         │   │
    │                  │         │Gera financeiro rest. │   │
    │                  │         └───────┬──────────────┘   │
    │                  │                 │                   │
    │                  └──────┬──────────┘                   │
    │                         │                              │
    │                         ▼                              │
    │              ┌──────────────────┐                      │
    │              │    FATURADO      │                      │
    │              │ NF-e + DANFE     │                      │
    │              │ Contas a receber │                      │
    │              │ Comissão gerada  │                      │
    │              └────────┬─────────┘                      │
    │                       │                                │
    │  Recebe mercadoria    │                                │
    ├──────────────────────▶│                                │
    │                       ▼                                │
    │              ┌──────────────────┐                      │
    │              │  RECIBO          │                      │
    │              │  (Finalizado)    │                      │
    │              └──────────────────┘                      │
    │                                                        │
```

---

## Apêndice B — Glossário

| Termo | Definição |
|-------|-----------|
| **NF-e** | Nota Fiscal Eletrônica — documento fiscal digital modelo 55 |
| **DANFE** | Documento Auxiliar da NF-e — representação gráfica (PDF) |
| **SEFAZ** | Secretaria de Fazenda — órgão fiscal estadual |
| **CFOP** | Código Fiscal de Operações e Prestações |
| **CST** | Código de Situação Tributária |
| **CSOSN** | Código de Situação da Operação do Simples Nacional |
| **NCM** | Nomenclatura Comum do Mercosul |
| **ICMS** | Imposto sobre Circulação de Mercadorias e Serviços |
| **IPI** | Imposto sobre Produtos Industrializados |
| **PIS** | Programa de Integração Social |
| **COFINS** | Contribuição para Financiamento da Seguridade Social |
| **ICMS-ST** | ICMS por Substituição Tributária |
| **DIFAL** | Diferencial de Alíquota |
| **FCP** | Fundo de Combate à Pobreza |
| **MVA** | Margem de Valor Agregado |
| **C14N** | Canonicalização XML (padrão W3C) |
| **RBAC** | Role-Based Access Control |
| **PFX/P12** | Formato de arquivo de certificado digital |
| **Meia Nota** | Faturamento parcial em duas etapas (5922 + 5117) |
| **Banker's Rounding** | Arredondamento ABNT NBR 5891 (para o par mais próximo) |

---

## 21. 🔴 REGIME TRIBUTÁRIO — Cadastro de Empresa

### 21.1 Diagnóstico: Estado Atual

**⚠️ PROBLEMA CRÍTICO: O sistema NÃO possui campo `regime_tributario` em nenhuma tabela de empresa.**

Existem **duas tabelas** de configuração da empresa que coexistem de forma inconsistente:

| Tabela | Migration | Tem campo regime? |
|--------|-----------|-------------------|
| `empresa_config` | `migrations/create_empresa_config.js` | ❌ NÃO |
| `configuracoes_empresa` | `migrations/20250215_configuracoes.js` | ❌ NÃO |

O regime tributário é tratado de **3 formas conflitantes** no código:

| Local | Valor | Arquivo |
|-------|-------|---------|
| PHP hardcoded | `EMITENTE_CRT = 3` (Regime Normal) | `modules/NFe/api/api.php` |
| JSON em tabela `configuracoes` | `config.regime_tributario` (fallback: `3`) | `modules/Faturamento/api/faturamento.js` |
| Default no serviço de cálculo | `regimeTributario = 'simples'` | `modules/Faturamento/services/calculo-tributos.service.js` |
| ENV variable | `process.env.REGIME_TRIBUTARIO` (fallback: `'3'`) | `modules/Faturamento/api/faturamento.js` |

**Conflito grave:** PHP assume CRT=3 (Regime Normal), mas JS `calculo-tributos.service.js` assume `'simples'` (Simples Nacional) como default.

### 21.2 Impacto do Regime Tributário na Tributação

O regime tributário da empresa emitente define **toda a base de cálculo fiscal**:

#### Simples Nacional (CRT = 1)
| Aspecto | Tratamento |
|---------|-----------|
| **ICMS** | Usa **CSOSN** (3 dígitos: 101, 102, 103, 201, 202, 203, 300, 400, 500, 900) |
| **PIS/COFINS** | Geralmente isentos (CST 99 ou 49) |
| **IPI** | Geralmente isento (CST 53 ou 99) |
| **ICMS-ST** | Pode ser substituído tributário (CSOSN 201/202/203) |
| **Crédito ICMS** | Alíquota de crédito SN (sublimite, geralmente 1,25% a 3,95%) |
| **XML NF-e** | Tag `<ICMSSN>` com `<CSOSN>` em vez de `<ICMS>` com `<CST>` |
| **DAS** | Tributos unificados (IRPJ, CSLL, PIS, COFINS, ICMS, ISS, CPP) |

#### Lucro Presumido (CRT = 2)
| Aspecto | Tratamento |
|---------|-----------|
| **ICMS** | Usa **CST** (2 dígitos: 00, 10, 20, 30, 40, 41, 50, 51, 60, 70, 90) |
| **PIS** | Alíquota cumulativa: **0,65%** (CST 01) |
| **COFINS** | Alíquota cumulativa: **3,00%** (CST 01) |
| **IPI** | Conforme tabela TIPI (se industrializador) |
| **IRPJ** | Base presumida sobre faturamento (8% indústria, 32% serviço) |
| **CSLL** | Base presumida (12% indústria, 32% serviço) |
| **XML NF-e** | Tag `<ICMS>` com `<CST>`, PIS/COFINS cumulativos |

#### Lucro Real (CRT = 3)
| Aspecto | Tratamento |
|---------|-----------|
| **ICMS** | Usa **CST** (idêntico ao Presumido) |
| **PIS** | Alíquota não-cumulativa: **1,65%** (CST 01, com direito a crédito) |
| **COFINS** | Alíquota não-cumulativa: **7,60%** (CST 01, com direito a crédito) |
| **IPI** | Conforme tabela TIPI (com direito a crédito) |
| **Créditos** | Direito a crédito de PIS/COFINS/ICMS/IPI sobre entradas |
| **IRPJ/CSLL** | Sobre lucro contábil real apurado |
| **XML NF-e** | Idêntico ao Presumido, mas alíquotas PIS/COFINS diferentes |
| **EFD Contribuições** | Obrigação acessória com escrituração detalhada de créditos |

### 21.3 CST vs CSOSN — Diferença Fundamental

```
┌───────────────────────────────────────────────────────────────────────┐
│                    REGIME NORMAL (Lucro Real / Presumido)             │
│                                                                       │
│  XML NF-e de SAÍDA:                                                  │
│  <ICMS>                                                              │
│    <ICMS00>            ← Tag varia conforme CST                      │
│      <orig>0</orig>    ← Origem da mercadoria                       │
│      <CST>00</CST>     ← 2 dígitos (00 a 90)                        │
│      <modBC>3</modBC>                                                │
│      <vBC>1000.00</vBC>                                              │
│      <pICMS>18.00</pICMS>                                            │
│      <vICMS>180.00</vICMS>                                           │
│    </ICMS00>                                                         │
│  </ICMS>                                                             │
│                                                                       │
│  PIS CST: 01 (tributável)                                            │
│  COFINS CST: 01 (tributável)                                         │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│                    SIMPLES NACIONAL                                   │
│                                                                       │
│  XML NF-e de SAÍDA:                                                  │
│  <ICMS>                                                              │
│    <ICMSSN102>         ← Tag varia conforme CSOSN                    │
│      <orig>0</orig>    ← Origem da mercadoria                       │
│      <CSOSN>102</CSOSN>← 3 dígitos (101 a 900)                      │
│    </ICMSSN102>                                                      │
│  </ICMS>                                                             │
│                                                                       │
│  PIS CST: 99 (outras operações) ou 49 (outras saídas)               │
│  COFINS CST: 99 ou 49                                                │
│                                                                       │
│  ⚠️ Empresas do SN NÃO destacam ICMS/PIS/COFINS em regra geral     │
│  ⚠️ Exceção: CSOSN 101 permite informar crédito de ICMS             │
└───────────────────────────────────────────────────────────────────────┘
```

### 21.4 Tabela de CSOSNs (Simples Nacional)

| CSOSN | Descrição | Quando Usar |
|-------|-----------|-------------|
| **101** | Tributada pelo SN com permissão de crédito | Venda para contribuinte ICMS |
| **102** | Tributada pelo SN sem permissão de crédito | Venda para consumidor final |
| **103** | Isenção do ICMS no SN para faixa de receita | Microempresas com receita até sublimite |
| **201** | Tributada com permissão de crédito e ST | Venda com Substituição Tributária |
| **202** | Tributada sem permissão de crédito e ST | ST para consumidor final |
| **203** | Isenção do ICMS no SN com ST | ST com isenção |
| **300** | Imune | Operações imunes (livros, jornais) |
| **400** | Não tributada pelo SN | Operações sem ICMS |
| **500** | ICMS cobrado anteriormente por ST | Revenda de ST |
| **900** | Outros | Situações não enquadradas |

### 21.5 O Que Precisa Ser Implementado

#### 21.5.1 Migração — Adicionar campo na tabela de empresa

```sql
-- Adicionar campo regime_tributario à tabela empresa_config
ALTER TABLE empresa_config ADD COLUMN regime_tributario ENUM(
  'simples_nacional',    -- CRT = 1
  'lucro_presumido',     -- CRT = 2  (NOVO - não existia)
  'lucro_real'           -- CRT = 3
) NOT NULL DEFAULT 'simples_nacional';

ALTER TABLE empresa_config ADD COLUMN regime_tributario_crt TINYINT(1) 
  NOT NULL DEFAULT 1 COMMENT 'CRT: 1=SN, 2=Presumido, 3=Real';

-- Campos adicionais necessários
ALTER TABLE empresa_config ADD COLUMN sublimite_icms DECIMAL(15,2) 
  DEFAULT 3600000.00 COMMENT 'Sublimite estadual para ICMS no SN';
ALTER TABLE empresa_config ADD COLUMN aliquota_credito_sn DECIMAL(5,4) 
  DEFAULT 0.0395 COMMENT 'Alíquota de crédito de ICMS SN';
ALTER TABLE empresa_config ADD COLUMN regime_pis_cofins ENUM(
  'cumulativo',       -- Lucro Presumido
  'nao_cumulativo',   -- Lucro Real
  'simples'           -- Simples Nacional
) DEFAULT 'simples';
```

#### 21.5.2 Tela de Cadastro — Campos necessários

O cadastro de empresa deve incluir:

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| Regime Tributário | Select | ✅ SIM | SN / LP / LR |
| CRT | Auto-preenchido | ✅ SIM | Derivado do regime |
| Sublimite ICMS (se SN) | Currency | Se SN | > 0 |
| Alíquota crédito ICMS SN | Percentual | Se SN | 0-5% |
| Regime PIS/COFINS | Auto-preenchido | ✅ SIM | Derivado do regime |
| Optante SIMEI (MEI) | Checkbox | Se SN | — |
| Data de opção pelo regime | Date | ✅ SIM | — |

#### 21.5.3 Impacto no Motor de Tributos

O `CalculoTributosService` precisa ser atualizado para:

1. **Ler o regime da empresa do banco** (não de variável de ambiente)
2. **Selecionar CST ou CSOSN** baseado no CRT da empresa
3. **Aplicar alíquotas corretas** de PIS/COFINS conforme regime:
   - SN: PIS=0, COFINS=0 (pagos no DAS)
   - LP: PIS=0,65%, COFINS=3,00% (cumulativo)
   - LR: PIS=1,65%, COFINS=7,60% (não-cumulativo, com créditos)
4. **Gerar XML correto**: `<ICMSSN>` para SN ou `<ICMS>` para Regime Normal

#### 21.5.4 Impacto na Entrada de Notas

O regime da empresa compradora define os **créditos aproveitáveis**:

| Regime do Comprador | Crédito ICMS | Crédito PIS/COFINS | Crédito IPI |
|---------------------|-------------|-------------------|-------------|
| Simples Nacional | ❌ Não | ❌ Não | ❌ Não |
| Lucro Presumido | ✅ Sim (se tributado) | ❌ Não (cumulativo) | ✅ Sim |
| Lucro Real | ✅ Sim (se tributado) | ✅ Sim (não-cumulativo) | ✅ Sim |

---

## 22. 🔴 REFORMA TRIBUTÁRIA — IBS e CBS

### 22.1 Diagnóstico: Estado Atual

**⚠️ O sistema tem ZERO implementação de IBS/CBS.**

Nenhuma referência a IBS, CBS, reforma tributária, `cClassTrib`, split payment ou EC 132/2023 foi encontrada no código-fonte.

### 22.2 O Que São IBS e CBS

A **Reforma Tributária** (EC 132/2023 + LC 214/2025) cria dois novos tributos que substituirão progressivamente os atuais:

| Tributo Novo | Substitui | Competência | Alíquota Referência |
|-------------|-----------|-------------|---------------------|
| **CBS** (Contribuição sobre Bens e Serviços) | PIS + COFINS | Federal | ~8,8% (estimada) |
| **IBS** (Imposto sobre Bens e Serviços) | ICMS + ISS | Estadual + Municipal | ~17,7% (estimada) |
| **IS** (Imposto Seletivo) | Parcialmente IPI | Federal | Variável por produto |

**Alíquota de referência total:** ~26,5% (IBS + CBS), podendo variar conforme produto/serviço.

### 22.3 Cronograma de Transição (MUITO IMPORTANTE)

```
┌───────────────────────────────────────────────────────────────────────┐
│  2026 — PERÍODO DE TESTE                                             │
│  • CBS: alíquota de 0,9% (teste)                                    │
│  • IBS: alíquota de 0,1% (teste)                                    │
│  • Campos IBS/CBS já OBRIGATÓRIOS na NF-e                           │
│  • Nota Técnica 2025.002: campo cClassTrib OBRIGATÓRIO               │
│  • Empresas de Lucro Real/Presumido: NF-e REJEITADA sem IBS/CBS     │
│  • Simples Nacional: ainda NÃO obrigatório em 2026                  │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  2027 — INÍCIO DA TRANSIÇÃO                                          │
│  • CBS entra em vigor definitivamente (substitui PIS/COFINS)         │
│  • IBS: alíquota reduzida (início da transição)                      │
│  • PIS/COFINS: extinto para Lucro Real/Presumido                     │
│  • Simples Nacional: obrigatório informar IBS/CBS na NF-e            │
│  • IPI: mantido apenas para produtos da ZFM (Zona Franca de Manaus) │
│  • Split Payment: retenção automática na liquidação financeira       │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  2029-2032 — TRANSIÇÃO GRADUAL                                       │
│  • ICMS/ISS: redução gradual de 10% ao ano                          │
│  • IBS: aumento proporcional à redução do ICMS/ISS                  │
│  • Convivência dos dois sistemas em paralelo                        │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  2033 — EXTINÇÃO TOTAL                                               │
│  • ICMS: EXTINTO                                                     │
│  • ISS: EXTINTO                                                      │
│  • PIS/COFINS: EXTINTO                                               │
│  • Apenas IBS + CBS + IS em vigor                                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 22.4 Nota Técnica 2025.002 — Mudanças na NF-e

A NT 2025.002 (publicada em 28/01/2026, versão 1.40) introduz:

#### 22.4.1 Novo campo `cClassTrib` (Classificação Tributária)

```xml
<ide>
  ...
  <cClassTrib>01</cClassTrib>  <!-- NOVO - OBRIGATÓRIO -->
  ...
</ide>
```

**Valores do `cClassTrib`:**
| Código | Descrição |
|--------|-----------|
| `01` | Operação tributável — Lucro Real |
| `02` | Operação tributável — Lucro Presumido |
| `03` | Operação tributável — Simples Nacional |
| `04` | Operação tributável — MEI |
| `05` | Operação tributável — outros regimes |
| `06` | Imune |
| `07` | Isenta |
| `08` | Com suspensão |
| `09` | Alíquota zero |
| `10` | Diferida |
| `50` | Exportação e assemelhadas |

#### 22.4.2 Novos grupos de tributos no XML da NF-e

```xml
<det nItem="1">
  <prod>...</prod>
  <imposto>
    <ICMS>...</ICMS>
    <IPI>...</IPI>
    <PIS>...</PIS>
    <COFINS>...</COFINS>
    
    <!-- ═══════ NOVOS GRUPOS — REFORMA TRIBUTÁRIA ═══════ -->
    <IBS>                              <!-- NOVO -->
      <CST>00</CST>
      <vBC>1000.00</vBC>
      <pIBS>17.70</pIBS>
      <vIBS>177.00</vIBS>
    </IBS>
    
    <CBS>                              <!-- NOVO -->
      <CST>00</CST>
      <vBC>1000.00</vBC>
      <pCBS>8.80</pCBS>
      <vCBS>88.00</vCBS>
    </CBS>
    
    <IS>                               <!-- NOVO (Imposto Seletivo) -->
      <CST>00</CST>
      <vBC>1000.00</vBC>
      <pIS>0.00</pIS>
      <vIS>0.00</vIS>
    </IS>
    <!-- ═══════════════════════════════════════════════════ -->
  </imposto>
</det>

<total>
  <ICMSTot>
    ...
    <!-- ═══════ NOVOS TOTAIS ═══════ -->
    <vIBS>177.00</vIBS>                <!-- NOVO -->
    <vCBS>88.00</vCBS>                 <!-- NOVO -->
    <vIS>0.00</vIS>                    <!-- NOVO -->
    <!-- ═══════════════════════════ -->
  </ICMSTot>
</total>
```

#### 22.4.3 Split Payment (Pagamento Cindido)

A partir de 2027, haverá **retenção automática** de IBS/CBS na liquidação financeira:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐
│   COMPRADOR   │───▶│   BANCO /    │───▶│   SPLIT AUTOMÁTICO        │
│   paga NF     │    │   ADQUIRENTE │    │                           │
│   R$ 1.265,00 │    │              │    │   R$ 1.000,00 → Vendedor  │
│               │    │              │    │   R$   177,00 → Fisco UF  │
│               │    │              │    │   R$    88,00 → Fisco Fed │
└──────────────┘    └──────────────┘    └──────────────────────────┘
```

### 22.5 O Que Precisa Ser Implementado

#### Prioridade 1 — URGENTE (2026, já em vigor para LR/LP)

| Item | Arquivo Afetado | Esforço |
|------|----------------|---------|
| Adicionar campo `cClassTrib` no XML `<ide>` | `xml-nfe.service.js` | Baixo |
| Adicionar grupos `<IBS>`, `<CBS>`, `<IS>` por item | `xml-nfe.service.js` | Médio |
| Adicionar totais `vIBS`, `vCBS`, `vIS` em `<ICMSTot>` | `xml-nfe.service.js` | Baixo |
| Criar cálculo IBS/CBS no motor de tributos | `calculo-tributos.service.js` | Alto |
| Tabela de alíquotas IBS/CBS por NCM | `tributacao.config.js` + banco | Alto |
| Atualizar tabela `nfe` com colunas IBS/CBS | `schema.sql` + migration | Baixo |
| Atualizar tabela `nfe_itens` com colunas IBS/CBS | `schema.sql` + migration | Baixo |
| Validação de regime: bloquear NF-e sem IBS/CBS se LR/LP | `faturamento.js` | Médio |

#### Prioridade 2 — 2027 (obrigatório para todos)

| Item | Descrição | Esforço |
|------|-----------|---------|
| Split Payment | Integrar com gateway de pagamento para retenção | Muito Alto |
| Simples Nacional com IBS/CBS | Cálculo diferenciado para SN | Alto |
| Crédito de IBS/CBS | Sistema de escrituração de créditos | Muito Alto |
| Apuração IBS/CBS | Relatório mensal de apuração | Alto |
| Período de convivência | Cálculo paralelo ICMS+IBS durante transição | Muito Alto |

#### 22.5.1 Exemplo de Cálculo IBS/CBS

```
Produto: Peça industrial
NCM: 8481.80.99
Valor: R$ 1.000,00

═══════ REGIME ATUAL (até 2026) ═══════
ICMS: 18% = R$ 180,00
PIS: 1,65% = R$ 16,50  (LR não-cumulativo)
COFINS: 7,60% = R$ 76,00

═══════ PERÍODO DE TESTE (2026) ═══════
ICMS: 18% = R$ 180,00  (mantido)
PIS: 1,65% = R$ 16,50  (mantido)
COFINS: 7,60% = R$ 76,00  (mantido)
CBS: 0,9% = R$ 9,00    (TESTE, adicional)
IBS: 0,1% = R$ 1,00    (TESTE, adicional)

═══════ PÓS-TRANSIÇÃO (2033+) ═══════
IBS: ~17,7% = R$ 177,00   (substitui ICMS + ISS)
CBS: ~8,8% = R$ 88,00     (substitui PIS + COFINS)
IS: 0% = R$ 0,00          (só para produtos seletivos)
ICMS: EXTINTO
PIS/COFINS: EXTINTO
```

### 22.6 Alertas para Monitoramento Contínuo

> ⚠️ **A SEFAZ publica atualizações frequentes.** Recomenda-se monitorar:
> - https://www.nfe.fazenda.gov.br/portal/informe.aspx — Informes técnicos
> - Tabelas `cClassTrib` — Publicadas e atualizadas periodicamente
> - Ato Conjunto RFB/CGIBS nº 01/2025 — Regras do Split Payment
> - NT 2025.002 versões futuras — Campos podem mudar

---

## 23. 🔴 MÓDULO CONTÁBIL-FISCAL — SPED, Sintegra e Relatórios

### 23.1 Diagnóstico: Estado Atual

**⚠️ O sistema NÃO possui NENHUM módulo contábil-fiscal.**

- ❌ Sem geração de SPED Fiscal (EFD ICMS/IPI)
- ❌ Sem geração de SPED Contribuições (EFD PIS/COFINS)
- ❌ Sem geração de Sintegra
- ❌ Sem livro de entradas/saídas
- ❌ Sem relatório de PIS/COFINS
- ❌ Sem relatório de produtos monofásicos
- ❌ Sem Bloco K (controle de produção/estoque)

### 23.2 Obrigações Acessórias por Regime

| Obrigação | Simples Nacional | Lucro Presumido | Lucro Real |
|-----------|-----------------|-----------------|------------|
| **SPED Fiscal (EFD ICMS/IPI)** | ❌ Isento¹ | ✅ Obrigatório | ✅ Obrigatório |
| **SPED Contribuições (EFD PIS/COFINS)** | ❌ Isento | ✅ Obrigatório | ✅ Obrigatório |
| **Sintegra** | ⚠️ Depende do estado² | ✅ Alguns estados | ✅ Alguns estados |
| **GIA (ICMS)** | ❌ Isento | ✅ Depende do estado | ✅ Depende do estado |
| **DCTF** | ❌ Isento | ✅ Obrigatório | ✅ Obrigatório |
| **PGDAS-D** | ✅ Obrigatório | ❌ N/A | ❌ N/A |

¹ Exceto se ultrapassar sublimite de ICMS  
² Sintegra está sendo gradualmente substituído pelo SPED, mas ainda exigido em alguns estados

### 23.3 SPED Fiscal (EFD ICMS/IPI) — O Que É

O SPED Fiscal é um arquivo texto com layout definido pela RFB, composto por **blocos e registros**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  SPED FISCAL — Estrutura de Blocos                                   │
├─────────┬───────────────────────────────────────────────────────────┤
│ BLOCO 0 │ Abertura, Identificação e Referências                     │
│         │ 0000: Abertura do arquivo                                  │
│         │ 0150: Cadastro de participantes (clientes/fornecedores)    │
│         │ 0190: Unidades de medida                                   │
│         │ 0200: Cadastro de itens (produtos) com NCM                 │
│         │ 0220: Fatores de conversão de unidades                     │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO C │ Documentos Fiscais de Mercadorias (ICMS/IPI)              │
│         │ C100: NF-e de entrada/saída (cabeçalho)                   │
│         │ C170: Itens da NF-e (detalhamento)                        │
│         │ C190: Registro analítico (resumo por CST/CFOP/Alíquota)   │
│         │ C195: Observações do lançamento fiscal                     │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO D │ Documentos Fiscais de Serviço (ICMS)                      │
│         │ D100: CT-e (Conhecimento de Transporte)                   │
│         │ D190: Registro analítico do CT-e                           │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO E │ Apuração do ICMS e IPI                                    │
│         │ E100: Período de apuração ICMS                             │
│         │ E110: Apuração do ICMS — Operações próprias               │
│         │ E200: Apuração do ICMS — ST                                │
│         │ E500: Apuração do IPI                                      │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO G │ CIAP (Controle de Crédito de ICMS do Ativo Permanente)    │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO H │ Inventário Físico                                          │
│         │ H010: Inventário (estoque de fechamento)                   │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO K │ Controle da Produção e Estoque                             │
│         │ K100: Período de apuração                                  │
│         │ K200: Estoque escriturado                                  │
│         │ K230: Itens produzidos                                     │
│         │ K235: Insumos consumidos                                   │
│         │ ⚠️ OBRIGATÓRIO para indústrias!                            │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO 1 │ Informações complementares                                 │
│ BLOCO 9 │ Controle e encerramento do arquivo                        │
└─────────┴───────────────────────────────────────────────────────────┘
```

> **⚠️ IMPORTANTÍSSIMO:** O SPED Fiscal valida **tintim por tintim**. Um NCM diferente entre a entrada e a saída de um mesmo produto gera erro de validação. Por isso, o cadastro de produtos com dados fiscais corretos é **pré-requisito**.

### 23.4 SPED Contribuições (EFD PIS/COFINS) — O Que É

Escrituração detalhada de PIS e COFINS, incluindo **créditos** (para Lucro Real):

```
┌─────────────────────────────────────────────────────────────────────┐
│  SPED CONTRIBUIÇÕES — Estrutura de Blocos                            │
├─────────┬───────────────────────────────────────────────────────────┤
│ BLOCO 0 │ Abertura e cadastros (mesmos do SPED Fiscal)               │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO A │ Documentos de Serviços (NFS-e)                             │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO C │ Documentos de Mercadoria (NF-e entrada/saída)              │
│         │ C100: NF-e cabeçalho                                       │
│         │ C170: Itens com CST PIS/COFINS                             │
│         │ C175: Registro analítico PIS/COFINS                        │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO D │ Documentos de Transporte (CT-e)                            │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO F │ Demais documentos e operações                              │
│         │ F100: Créditos sobre bens incorporados ao ativo            │
│         │ F120: Bens do ativo imobilizado (créditos)                 │
│         │ F200: Receitas de atividade imobiliária                    │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO M │ Apuração da Contribuição e Crédito de PIS/COFINS          │
│         │ M100: Crédito de PIS                                       │
│         │ M200: Consolidação PIS                                     │
│         │ M500: Crédito de COFINS                                    │
│         │ M600: Consolidação COFINS                                  │
├─────────┼───────────────────────────────────────────────────────────┤
│ BLOCO 1 │ Complementar                                               │
│ BLOCO 9 │ Controle e encerramento                                    │
└─────────┴───────────────────────────────────────────────────────────┘
```

### 23.5 Sintegra — O Que É

Arquivo texto mais simples que o SPED, usado por alguns estados para controle de ICMS:

| Registro | Conteúdo |
|----------|----------|
| **10** | Mestre do estabelecimento |
| **11** | Dados complementares |
| **50** | NF modelo 1/1A (entradas/saídas) |
| **54** | Itens das notas fiscais |
| **61** | ECF (Cupom Fiscal) |
| **70** | Conhecimentos de transporte (CT-e) |
| **74** | Inventário |
| **75** | Código do produto ou serviço |
| **90** | Totalização |

### 23.6 Relatórios Necessários

| Relatório | Descrição | Regime |
|-----------|-----------|--------|
| **Livro de Entradas** | Registro de todas as NF-e de entrada, com CFOP, base ICMS, créditos | LR/LP |
| **Livro de Saídas** | Registro de todas as NF-e de saída, com CFOP, débitos ICMS | LR/LP |
| **Apuração PIS/COFINS** | Débitos - Créditos = Valor a pagar | LR/LP |
| **Produtos Monofásicos** | Produtos com tributação concentrada (CST 04/05) — combustíveis, bebidas, fármacos, autopeças | LR/LP |
| **Mapa de ICMS** | Resumo de entradas/saídas por CFOP e alíquota | LR/LP |
| **Relatório de ST** | Substituição Tributária — ICMS retido na fonte | LR/LP |
| **DCTF** | Declaração de débitos e créditos federais | LR/LP |

### 23.7 Produtos Monofásicos — Detalhamento

**Produtos monofásicos** têm tributação **concentrada na indústria/importador**. O distribuidor/varejista **não paga PIS/COFINS** sobre esses produtos (CST 04 - Alíquota Zero):

| Categoria | NCMs Exemplo | PIS/COFINS |
|-----------|-------------|-----------|
| Combustíveis | 2710.xx | Monofásico |
| Bebidas frias | 2201.xx, 2202.xx | Monofásico |
| Fármacos | 3001 a 3006 | Monofásico |
| Perfumaria/Higiene | 3303 a 3307 | Monofásico |
| Autopeças | Lista ANP | Monofásico |
| Pneus | 4011.xx | Monofásico |
| Máquinas/Veículos | 8429, 8432, 8433... | Monofásico (alguns) |

> **⚠️ Se a ALUFORCE é uma indústria**, pode ser o **concentrador** da tributação monofásica — nesse caso, PAGA PIS/COFINS majorado e os revendedores não pagam.

### 23.8 Proposta de Módulo Contábil-Fiscal

```
modules/
  ContabilFiscal/
    server.js                    ← Servidor Express (porta 3004)
    api/
      contabil-fiscal.js         ← Endpoints do módulo
    services/
      sped-fiscal.service.js     ← Geração EFD ICMS/IPI
      sped-contribuicoes.service.js ← Geração EFD PIS/COFINS
      sintegra.service.js        ← Geração arquivo Sintegra
      livro-fiscal.service.js    ← Livros de entrada/saída
      apuracao-icms.service.js   ← Apuração de ICMS
      apuracao-pis-cofins.service.js ← Apuração PIS/COFINS
      monofasico.service.js      ← Controle de produtos monofásicos
    config/
      sped-layout.config.js      ← Layout dos registros SPED
      sintegra-layout.config.js  ← Layout dos registros Sintegra
      ncm-monofasico.config.js   ← Tabela de NCMs monofásicos
    database/
      schema.sql                 ← Tabelas do módulo
    public/
      index.html                 ← Dashboard contábil-fiscal
      sped-fiscal.html           ← Tela de geração SPED Fiscal
      sped-contribuicoes.html    ← Tela de geração SPED Contribuições
      sintegra.html              ← Tela de geração Sintegra
      livros.html                ← Livros de entrada/saída
      apuracao.html              ← Apuração de impostos
```

### 23.9 Tabelas Necessárias

```sql
-- Escrituração fiscal de entradas e saídas
CREATE TABLE escrituracao_fiscal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('entrada', 'saida') NOT NULL,
  nfe_chave VARCHAR(44) NOT NULL,
  nfe_numero VARCHAR(20),
  nfe_serie VARCHAR(5),
  data_emissao DATE NOT NULL,
  data_entrada_saida DATE,
  participante_cnpj_cpf VARCHAR(14),
  participante_nome VARCHAR(255),
  cfop VARCHAR(4) NOT NULL,
  valor_total DECIMAL(15,2),
  base_icms DECIMAL(15,2) DEFAULT 0,
  valor_icms DECIMAL(15,2) DEFAULT 0,
  base_icms_st DECIMAL(15,2) DEFAULT 0,
  valor_icms_st DECIMAL(15,2) DEFAULT 0,
  valor_ipi DECIMAL(15,2) DEFAULT 0,
  valor_pis DECIMAL(15,2) DEFAULT 0,
  valor_cofins DECIMAL(15,2) DEFAULT 0,
  valor_ibs DECIMAL(15,2) DEFAULT 0,
  valor_cbs DECIMAL(15,2) DEFAULT 0,
  situacao ENUM('normal', 'cancelada', 'inutilizada', 'denegada') DEFAULT 'normal',
  periodo_apuracao VARCHAR(7), -- 'YYYY-MM'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Escrituração por item (C170/C175)
CREATE TABLE escrituracao_fiscal_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escrituracao_id INT NOT NULL,
  produto_id INT,
  ncm VARCHAR(8),
  cfop VARCHAR(4),
  cst_icms VARCHAR(3),
  cst_pis VARCHAR(2),
  cst_cofins VARCHAR(2),
  quantidade DECIMAL(15,4),
  valor_unitario DECIMAL(15,6),
  valor_total DECIMAL(15,2),
  base_icms DECIMAL(15,2) DEFAULT 0,
  aliquota_icms DECIMAL(5,2) DEFAULT 0,
  valor_icms DECIMAL(15,2) DEFAULT 0,
  base_pis DECIMAL(15,2) DEFAULT 0,
  aliquota_pis DECIMAL(5,4) DEFAULT 0,
  valor_pis DECIMAL(15,2) DEFAULT 0,
  base_cofins DECIMAL(15,2) DEFAULT 0,
  aliquota_cofins DECIMAL(5,4) DEFAULT 0,
  valor_cofins DECIMAL(15,2) DEFAULT 0,
  monofasico TINYINT(1) DEFAULT 0,
  FOREIGN KEY (escrituracao_id) REFERENCES escrituracao_fiscal(id)
);

-- Apuração mensal de ICMS
CREATE TABLE apuracao_icms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periodo VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  debitos DECIMAL(15,2) DEFAULT 0,
  creditos DECIMAL(15,2) DEFAULT 0,
  saldo_credor_anterior DECIMAL(15,2) DEFAULT 0,
  ajustes_debito DECIMAL(15,2) DEFAULT 0,
  ajustes_credito DECIMAL(15,2) DEFAULT 0,
  imposto_a_recolher DECIMAL(15,2) DEFAULT 0,
  saldo_credor_proximo DECIMAL(15,2) DEFAULT 0,
  status ENUM('aberto', 'fechado', 'retificado') DEFAULT 'aberto',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Apuração mensal de PIS/COFINS
CREATE TABLE apuracao_pis_cofins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periodo VARCHAR(7) NOT NULL,
  tipo ENUM('pis', 'cofins') NOT NULL,
  regime ENUM('cumulativo', 'nao_cumulativo') NOT NULL,
  receita_bruta DECIMAL(15,2) DEFAULT 0,
  debitos DECIMAL(15,2) DEFAULT 0,
  creditos DECIMAL(15,2) DEFAULT 0,
  retencoes DECIMAL(15,2) DEFAULT 0,
  valor_a_pagar DECIMAL(15,2) DEFAULT 0,
  status ENUM('aberto', 'fechado', 'retificado') DEFAULT 'aberto',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Controle de geração de arquivos
CREATE TABLE arquivos_fiscais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('sped_fiscal', 'sped_contribuicoes', 'sintegra') NOT NULL,
  periodo VARCHAR(7) NOT NULL,
  versao INT DEFAULT 1,
  hash_arquivo VARCHAR(64),
  caminho_arquivo VARCHAR(500),
  status ENUM('gerado', 'validado', 'transmitido', 'retificado') DEFAULT 'gerado',
  recibo_transmissao VARCHAR(50),
  observacoes TEXT,
  usuario_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 24. 🔴 CT-e — Conhecimento de Transporte Eletrônico

### 24.1 Diagnóstico: Estado Atual

**⚠️ O sistema tem ZERO implementação de CT-e.**

Nenhum código, tabela, rota ou arquivo relacionado a CT-e foi encontrado.

### 24.2 O Que É o CT-e

O **CT-e (Conhecimento de Transporte Eletrônico)** é o documento fiscal eletrônico modelo **57** que documenta a prestação de serviço de transporte de cargas:

```
┌─────────────────────────────────────────────────────────────────────┐
│  FLUXO DO CT-e                                                       │
│                                                                       │
│  TRANSPORTADORA                                                      │
│       │                                                               │
│       ▼                                                               │
│  Emite CT-e ──▶ SEFAZ (autoriza) ──▶ DACTE (PDF)                    │
│       │                                                               │
│       ▼                                                               │
│  EMBARCADOR (quem contrata o frete)                                  │
│       │                                                               │
│       ├── Vínculo com NF-e de saída (remetente)                      │
│       └── Vínculo com NF-e de entrada (destinatário)                 │
│                                                                       │
│  PARA A ALUFORCE (como INDÚSTRIA):                                   │
│  • RECEBE CT-e de fretes de entrada (compra de matéria-prima)        │
│  • RECEBE CT-e de fretes de saída (entrega de produto acabado)       │
│  • Se tem frota própria: EMITE CT-e                                  │
│  • Obrigada a manifestar CT-e (ciência/confirmação)                  │
│  • CT-e entra no SPED Fiscal (Bloco D - registros D100/D190)        │
│  • CT-e entra no SPED Contribuições (crédito de PIS/COFINS)         │
└─────────────────────────────────────────────────────────────────────┘
```

### 24.3 Por que CT-e é Importante para Indústrias

| Situação | Impacto |
|----------|---------|
| **Recebimento de matéria-prima** | CT-e do frete de entrada → crédito de ICMS/PIS/COFINS |
| **Envio de produto acabado** | CT-e do frete de saída → compõe custo do frete na NF-e |
| **SPED Fiscal** | Bloco D obrigatório — sem CT-e, o SPED fica incompleto |
| **Custo de produção** | Frete de entrada compõe custo do produto (Bloco K) |
| **Manifestação** | Obrigada a manifestar CT-e recebidos (igual NF-e) |

### 24.4 Estrutura XML do CT-e (v4.00)

```xml
<CTe xmlns="http://www.portalfiscal.inf.br/cte">
  <infCte Id="CTe{chave44}" versao="4.00">
    <ide>
      <!-- Identificação: UF, CFOP, natOp, mod(57), serie, nCT, dhEmi -->
      <tpCTe>0</tpCTe>  <!-- 0=Normal, 1=Complementar, 2=Anulação, 3=Substituto -->
      <modal>01</modal>  <!-- 01=Rodoviário, 02=Aéreo, 03=Aquaviário, 04=Ferroviário -->
    </ide>
    <compl><!-- Complemento --></compl>
    <emit><!-- Emitente (transportadora) --></emit>
    <rem><!-- Remetente --></rem>
    <dest><!-- Destinatário --></dest>
    <vPrest>
      <vTPrest>1500.00</vTPrest>  <!-- Valor total da prestação -->
      <vRec>1500.00</vRec>        <!-- Valor a receber -->
    </vPrest>
    <imp>
      <ICMS><!-- Tributos do CT-e --></ICMS>
    </imp>
    <infCTeNorm>
      <infDoc>
        <infNFe>
          <chave>12345678901234567890123456789012345678901234</chave>
          <!-- NF-e vinculada ao transporte -->
        </infNFe>
      </infDoc>
      <infModal>
        <rodo><!-- Dados do modal rodoviário --></rodo>
      </infModal>
    </infCTeNorm>
  </infCte>
</CTe>
```

### 24.5 Proposta de Implementação

```
modules/
  CTe/
    server.js
    api/
      cte-emissao.js          ← Emissão de CT-e (se frota própria)
      cte-importacao.js        ← Importação de CT-e XML recebidos
      cte-manifestacao.js      ← Manifestação de CT-e
    services/
      xml-cte.service.js       ← Geração XML CT-e 4.00
      sefaz-cte.service.js     ← Comunicação SEFAZ para CT-e
      dacte.service.js         ← Geração de DACTE (PDF)
    config/
      cte.config.js            ← URLs SEFAZ CT-e por UF
    public/
      emitir.html              ← Wizard de emissão
      consultar.html           ← Consulta de CT-e
      importar.html            ← Importação de XML
      dacte.html               ← Visualização DACTE
    database/
      schema.sql
```

**Tabelas necessárias:**
```sql
CREATE TABLE cte (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chave_acesso VARCHAR(44) UNIQUE NOT NULL,
  numero INT NOT NULL,
  serie INT DEFAULT 1,
  tipo ENUM('emitido', 'recebido') NOT NULL,
  modal ENUM('rodoviario', 'aereo', 'aquaviario', 'ferroviario') DEFAULT 'rodoviario',
  emitente_cnpj VARCHAR(14),
  emitente_nome VARCHAR(255),
  remetente_cnpj VARCHAR(14),
  remetente_nome VARCHAR(255),
  destinatario_cnpj VARCHAR(14),
  destinatario_nome VARCHAR(255),
  valor_prestacao DECIMAL(15,2),
  valor_receber DECIMAL(15,2),
  base_icms DECIMAL(15,2) DEFAULT 0,
  aliquota_icms DECIMAL(5,2) DEFAULT 0,
  valor_icms DECIMAL(15,2) DEFAULT 0,
  cfop VARCHAR(4),
  data_emissao DATETIME,
  data_entrada DATE,
  xml_cte LONGTEXT,
  xml_assinado LONGTEXT,
  protocolo VARCHAR(20),
  status ENUM('pendente','autorizado','cancelado','denegado','rejeitado') DEFAULT 'pendente',
  nfe_vinculada_chave VARCHAR(44),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cte_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cte_id INT NOT NULL,
  tipo_evento VARCHAR(10),
  descricao VARCHAR(255),
  protocolo VARCHAR(20),
  xml_evento LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cte_id) REFERENCES cte(id)
);
```

---

## 25. 🟡 MD-e — Manifestação do Destinatário Eletrônica

### 25.1 Diagnóstico: Estado Atual

**✅ Parcialmente implementado** em `modules/NFe/api/manifestacao-destinatario.js` (491 linhas).

### 25.2 O Que Funciona

| Funcionalidade | Status |
|----------------|--------|
| Geração de XML de evento | ✅ Implementado |
| Validação de chave 44 dígitos + DV | ✅ Implementado |
| Confirmação (210200) | ✅ Código gerado |
| Ciência (210210) | ✅ Código gerado |
| Desconhecimento (210220) | ✅ Código gerado |
| Não Realizada (210240) | ✅ Código gerado |
| JWT Authentication | ✅ Implementado |
| express-validator | ✅ Implementado |

### 25.3 O Que NÃO Funciona

| Funcionalidade | Status |
|----------------|--------|
| **Transmissão para SEFAZ** | ❌ XML gerado mas NÃO enviado (TODO no código) |
| **Protocolo real** | ❌ Retorna protocolo simulado |
| **Consulta DistDFeInt** | ❌ Não busca NF-e da SEFAZ automaticamente |
| **Download de NF-e** | ❌ Não baixa XML das NF-e manifestadas |
| **Webhook/polling** | ❌ Não verifica NF-e novas periodicamente |
| **Vinculação com NF entrada** | ❌ Não integra com escrituração fiscal |

### 25.4 Fluxo Completo Esperado (a implementar)

```
┌──────────────────────────────────────────────────────────────────┐
│  1. CONSULTA AUTOMÁTICA (DistDFeInt)                              │
│     Sistema consulta periodicamente na SEFAZ por NF-e emitidas   │
│     contra o CNPJ da empresa (a cada 1h ou sob demanda)          │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  2. CIÊNCIA DA OPERAÇÃO (210210)                                  │
│     Sistema registra ciência automaticamente para NF-e novas     │
│     Permite download do XML completo da NF-e                     │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  3. ANÁLISE PELO USUÁRIO                                          │
│     • Confere NF-e vs Pedido de Compra                           │
│     • Confere física (recebimento real)                          │
│     • Valida preços, quantidades, dados fiscais                  │
└──────────┬──────────────────────┬────────────────────────────────┘
           │                      │
     ┌─────▼──────┐        ┌─────▼──────────────┐
     │ CONFIRMA   │        │ DESCONHECE         │
     │ (210200)   │        │ (210220)           │
     └─────┬──────┘        │ ou NÃO REALIZADA   │
           │               │ (210240)           │
           │               └────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  4. ESCRITURAÇÃO                                                  │
│     NF-e confirmada → Escrituração fiscal de entrada              │
│     → Créditos de ICMS/PIS/COFINS (conforme regime)              │
│     → Atualização de estoque                                      │
│     → Vinculação com pedido de compra                             │
│     → Entrada no SPED Fiscal (Bloco C) e Contribuições           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 26. 🔴 ENTRADA DE NOTAS FISCAIS

### 26.1 Diagnóstico: Estado Atual

O sistema **NÃO possui um módulo dedicado de NF de Entrada**. A entrada é feita **apenas via importação de XML** em `modules/NFe/api/nfe-importacao.js` (651 linhas).

| Funcionalidade | Status |
|----------------|--------|
| Upload de XML único | ✅ Implementado |
| Upload de lote (até 50) | ✅ Implementado |
| Parse de XML completo | ✅ Implementado (emitente, dest, itens, tributos, totais) |
| Armazenamento em banco de dados | ❌ Salva apenas em **arquivo JSON** no filesystem |
| Digitação manual de NF | ❌ Não implementado |
| Conferência física | ❌ Não implementado |
| Vinculação com pedido de compra | ❌ Não implementado |
| Escrituração fiscal de entrada | ❌ Não implementado |
| Atualização automática de estoque | ❌ Parcial (apenas via `nf-compra` no financeiro) |
| Créditos de ICMS/PIS/COFINS | ❌ Não implementado |
| Validação NCM entrada vs cadastro | ❌ Não implementado |

### 26.2 O Que Existe na Importação

O parse do XML extrai:
- **ide**: natureza da operação, série, número, data emissão, tipo NF, finalidade
- **emit**: CNPJ, razão social, IE, **CRT** do emitente, endereço completo
- **dest**: CNPJ/CPF, razão social, IE
- **det/produtos**: código, EAN, descrição, NCM, CFOP, unidade, quantidade, valor + tributos (ICMS, IPI, PIS, COFINS)
- **total**: ICMSTot completo (vProd, vBC, vICMS, vIPI, vPIS, vCOFINS, vNF, etc.)
- **transp**, **cobr**, **pag**, **infAdic**, **protocolo**

### 26.3 Integração Parcial Existente

Em `routes/financeiro-extended.js`:
```
POST /integracao/estoque/nf-compra
```
- Aceita dados de NF de compra
- Insere em `contas_pagar`
- Atualiza `estoque_atual` dos produtos
- Insere em `estoque_movimentacoes` (tipo `entrada`)

**Limitação:** Não faz escrituração fiscal, não calcula créditos, não valida NCM.

### 26.4 Módulo Completo de NF de Entrada Necessário

```
modules/
  EntradaNotas/
    server.js
    api/
      entrada-notas.js           ← CRUD completo
    services/
      importacao-xml.service.js  ← Importação + parse + persistência no banco
      conferencia.service.js     ← Conferência física vs NF
      escrituracao.service.js    ← Escrituração fiscal (entrada)
      creditos.service.js        ← Cálculo de créditos ICMS/PIS/COFINS
      estoque-entrada.service.js ← Atualização de estoque
    public/
      index.html                 ← Dashboard de NF de entrada
      importar.html              ← Upload de XML
      digitar.html               ← Digitação manual
      conferir.html              ← Conferência física
```

**Tabelas necessárias:**
```sql
CREATE TABLE nfe_entrada (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chave_acesso VARCHAR(44) UNIQUE,
  numero VARCHAR(20),
  serie VARCHAR(5),
  emitente_cnpj VARCHAR(14),
  emitente_nome VARCHAR(255),
  emitente_crt TINYINT(1), -- Regime do FORNECEDOR
  data_emissao DATE,
  data_entrada DATE,
  natureza_operacao VARCHAR(100),
  cfop_principal VARCHAR(4),
  valor_total DECIMAL(15,2),
  base_icms DECIMAL(15,2) DEFAULT 0,
  valor_icms DECIMAL(15,2) DEFAULT 0,
  valor_icms_st DECIMAL(15,2) DEFAULT 0,
  valor_ipi DECIMAL(15,2) DEFAULT 0,
  valor_pis DECIMAL(15,2) DEFAULT 0,
  valor_cofins DECIMAL(15,2) DEFAULT 0,
  valor_frete DECIMAL(15,2) DEFAULT 0,
  valor_seguro DECIMAL(15,2) DEFAULT 0,
  valor_desconto DECIMAL(15,2) DEFAULT 0,
  -- Créditos aproveitáveis (calculados conforme regime da empresa)
  credito_icms DECIMAL(15,2) DEFAULT 0,
  credito_pis DECIMAL(15,2) DEFAULT 0,
  credito_cofins DECIMAL(15,2) DEFAULT 0,
  credito_ipi DECIMAL(15,2) DEFAULT 0,
  -- Controle
  xml_nfe LONGTEXT,
  pedido_compra_id INT,
  manifestacao_status VARCHAR(20),
  conferencia_status ENUM('pendente','conferido','divergente') DEFAULT 'pendente',
  escriturado TINYINT(1) DEFAULT 0,
  periodo_apuracao VARCHAR(7),
  status ENUM('pendente','escriturada','cancelada','devolvida') DEFAULT 'pendente',
  usuario_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE nfe_entrada_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nfe_entrada_id INT NOT NULL,
  numero_item INT,
  produto_id INT, -- Vincula com cadastro interno
  produto_codigo_fornecedor VARCHAR(60),
  descricao VARCHAR(255),
  ncm VARCHAR(8),
  cfop VARCHAR(4),
  cst_icms VARCHAR(3),
  cst_pis VARCHAR(2),
  cst_cofins VARCHAR(2),
  cst_ipi VARCHAR(2),
  unidade VARCHAR(6),
  quantidade DECIMAL(15,4),
  valor_unitario DECIMAL(15,6),
  valor_total DECIMAL(15,2),
  base_icms DECIMAL(15,2) DEFAULT 0,
  aliquota_icms DECIMAL(5,2) DEFAULT 0,
  valor_icms DECIMAL(15,2) DEFAULT 0,
  base_pis DECIMAL(15,2) DEFAULT 0,
  aliquota_pis DECIMAL(5,4) DEFAULT 0,
  valor_pis DECIMAL(15,2) DEFAULT 0,
  base_cofins DECIMAL(15,2) DEFAULT 0,
  aliquota_cofins DECIMAL(5,4) DEFAULT 0,
  valor_cofins DECIMAL(15,2) DEFAULT 0,
  valor_ipi DECIMAL(15,2) DEFAULT 0,
  -- Créditos por item
  credito_icms DECIMAL(15,2) DEFAULT 0,
  credito_pis DECIMAL(15,2) DEFAULT 0,
  credito_cofins DECIMAL(15,2) DEFAULT 0,
  monofasico TINYINT(1) DEFAULT 0,
  FOREIGN KEY (nfe_entrada_id) REFERENCES nfe_entrada(id)
);
```

---

## 27. 🔴 CADASTRO DE PRODUTOS — Análise Fiscal

### 27.1 Diagnóstico: Estado Atual

O cadastro de produtos existe em `routes/produtos-routes.js` (254 linhas) com os campos:

| Campo Existente | Status |
|----------------|--------|
| `id`, `codigo`, `nome`, `descricao` | ✅ OK |
| `gtin` (EAN) | ✅ OK |
| `sku`, `marca`, `variacao` | ✅ OK |
| `custo_unitario` | ✅ OK |
| `unidade_medida` | ✅ OK |
| `ncm` | ✅ OK |
| `categoria` | ✅ OK |
| `estoque_atual`, `estoque_minimo` | ✅ OK |

### 27.2 Campos Fiscais AUSENTES (Obrigatórios)

**⚠️ CRÍTICO: Faltam TODOS os campos fiscais necessários para emissão correta de NF-e:**

| Campo Ausente | Tipo | Obrigatório | Impacto |
|--------------|------|-------------|---------|
| `cfop_padrao` | VARCHAR(4) | ✅ SIM | CFOP padrão do produto nas saídas |
| `cest` | VARCHAR(7) | ⚠️ Se ST | Código Especificador da ST |
| `origem` | TINYINT(1) | ✅ SIM | Origem da mercadoria (0=Nacional, 1-8=Importado) |
| `cst_icms` | VARCHAR(3) | ✅ SIM | CST ICMS para Regime Normal |
| `csosn` | VARCHAR(3) | ✅ SIM | CSOSN para Simples Nacional |
| `aliquota_icms` | DECIMAL(5,2) | ✅ SIM | Alíquota ICMS padrão |
| `cst_pis` | VARCHAR(2) | ✅ SIM | CST PIS |
| `cst_cofins` | VARCHAR(2) | ✅ SIM | CST COFINS |
| `cst_ipi` | VARCHAR(2) | ✅ SIM | CST IPI |
| `aliquota_pis` | DECIMAL(5,4) | ✅ SIM | Alíquota PIS |
| `aliquota_cofins` | DECIMAL(5,4) | ✅ SIM | Alíquota COFINS |
| `aliquota_ipi` | DECIMAL(5,2) | ✅ SIM | Alíquota IPI |
| `codigo_beneficio_fiscal` | VARCHAR(10) | ⚠️ Depende UF | Código benefício fiscal (cBenef) |
| `ex_tipi` | VARCHAR(3) | ⚠️ Se aplicável | Exceção TIPI |
| `peso_liquido` | DECIMAL(12,3) | ✅ SIM | Para NF-e e transportes |
| `peso_bruto` | DECIMAL(12,3) | ✅ SIM | Para NF-e e transportes |
| `monofasico` | TINYINT(1) | ✅ SIM | Flag de produto monofásico |
| `aliquota_ibs` | DECIMAL(5,2) | 🔜 2026+ | Alíquota IBS (reforma) |
| `aliquota_cbs` | DECIMAL(5,2) | 🔜 2026+ | Alíquota CBS (reforma) |
| `classificacao_tributaria` | VARCHAR(2) | 🔜 2026+ | cClassTrib da NT 2025.002 |

### 27.3 Migração Necessária

```sql
ALTER TABLE produtos
  ADD COLUMN cfop_padrao VARCHAR(4) DEFAULT '5102',
  ADD COLUMN cest VARCHAR(7) DEFAULT NULL,
  ADD COLUMN origem TINYINT(1) DEFAULT 0 COMMENT '0=Nacional, 1-8=Importado',
  ADD COLUMN cst_icms VARCHAR(3) DEFAULT '00',
  ADD COLUMN csosn VARCHAR(3) DEFAULT '102',
  ADD COLUMN aliquota_icms DECIMAL(5,2) DEFAULT 18.00,
  ADD COLUMN cst_pis VARCHAR(2) DEFAULT '01',
  ADD COLUMN cst_cofins VARCHAR(2) DEFAULT '01',
  ADD COLUMN cst_ipi VARCHAR(2) DEFAULT '50',
  ADD COLUMN aliquota_pis DECIMAL(5,4) DEFAULT 1.6500,
  ADD COLUMN aliquota_cofins DECIMAL(5,4) DEFAULT 7.6000,
  ADD COLUMN aliquota_ipi DECIMAL(5,2) DEFAULT 0.00,
  ADD COLUMN codigo_beneficio_fiscal VARCHAR(10) DEFAULT NULL,
  ADD COLUMN ex_tipi VARCHAR(3) DEFAULT NULL,
  ADD COLUMN peso_liquido DECIMAL(12,3) DEFAULT 0,
  ADD COLUMN peso_bruto DECIMAL(12,3) DEFAULT 0,
  ADD COLUMN monofasico TINYINT(1) DEFAULT 0,
  ADD COLUMN aliquota_ibs DECIMAL(5,2) DEFAULT 0 COMMENT 'Reforma Tributária',
  ADD COLUMN aliquota_cbs DECIMAL(5,2) DEFAULT 0 COMMENT 'Reforma Tributária',
  ADD COLUMN classificacao_tributaria VARCHAR(2) DEFAULT NULL COMMENT 'cClassTrib NT 2025.002';
```

### 27.4 Impacto no Fluxo de Faturamento

Com os campos fiscais no cadastro de produtos, o fluxo de emissão de NF-e passa a ser:

```
ANTES (problemático):
  Faturar → Hardcoded ICMS 18%, PIS 1.65%, COFINS 7.6% → XML

DEPOIS (correto):
  Faturar → Ler regime_tributario da empresa
         → Se SN: usar CSOSN do produto
         → Se LR/LP: usar CST do produto
         → Buscar alíquotas do cadastro de produto
         → Verificar monofásico → Se sim, CST PIS/COFINS = 04
         → Calcular IBS/CBS (se regime obrigar)
         → Gerar XML com dados corretos
```

---

## 28. Roadmap de Implementação Priorizado

### 28.1 Fase 1 — URGENTE (Compliance Fiscal Básico) ⏱️ 2-3 semanas

| # | Item | Prioridade | Complexidade |
|---|------|-----------|-------------|
| 1.1 | Adicionar `regime_tributario` na tabela `empresa_config` | 🔴 Crítico | Baixa |
| 1.2 | Tela de cadastro de empresa com regime tributário | 🔴 Crítico | Média |
| 1.3 | Adicionar campos fiscais na tabela `produtos` | 🔴 Crítico | Baixa |
| 1.4 | Tela de cadastro de produto com aba fiscal | 🔴 Crítico | Média |
| 1.5 | Corrigir motor de tributos para ler regime do banco | 🔴 Crítico | Média |
| 1.6 | Corrigir XML para usar CST ou CSOSN conforme regime | 🔴 Crítico | Alta |
| 1.7 | Unificar defaults de CRT (eliminar conflito PHP vs JS) | 🔴 Crítico | Baixa |

### 28.2 Fase 2 — IBS/CBS (Obrigatório 2026 para LR/LP) ⏱️ 3-4 semanas

| # | Item | Prioridade | Complexidade |
|---|------|-----------|-------------|
| 2.1 | Adicionar `cClassTrib` no XML `<ide>` | 🔴 Crítico | Baixa |
| 2.2 | Adicionar grupos `<IBS>`, `<CBS>`, `<IS>` no XML | 🔴 Crítico | Média |
| 2.3 | Motor de cálculo IBS/CBS | 🔴 Crítico | Alta |
| 2.4 | Tabela de alíquotas IBS/CBS por NCM | 🟡 Alto | Média |
| 2.5 | Adicionar totais IBS/CBS no `<ICMSTot>` | 🔴 Crítico | Baixa |
| 2.6 | Atualizar schema de banco (colunas IBS/CBS) | 🟡 Alto | Baixa |

### 28.3 Fase 3 — Entrada de Notas e Escrituração ⏱️ 4-6 semanas

| # | Item | Prioridade | Complexidade |
|---|------|-----------|-------------|
| 3.1 | Módulo NF de Entrada (importação XML → banco) | 🔴 Crítico | Alta |
| 3.2 | Conferência física (NF vs recebimento) | 🟡 Alto | Média |
| 3.3 | Escrituração fiscal de entrada | 🔴 Crítico | Alta |
| 3.4 | Cálculo de créditos ICMS/PIS/COFINS conforme regime | 🔴 Crítico | Alta |
| 3.5 | Completar MD-e (transmissão real para SEFAZ) | 🔴 Crítico | Média |
| 3.6 | Consulta DistDFeInt automática | 🟡 Alto | Média |

### 28.4 Fase 4 — Módulo Contábil-Fiscal ⏱️ 6-8 semanas

| # | Item | Prioridade | Complexidade |
|---|------|-----------|-------------|
| 4.1 | Livro de Entradas digital | 🔴 Crítico | Alta |
| 4.2 | Livro de Saídas digital | 🔴 Crítico | Alta |
| 4.3 | Geração SPED Fiscal (EFD ICMS/IPI) | 🔴 Crítico | Muito Alta |
| 4.4 | Geração SPED Contribuições (EFD PIS/COFINS) | 🔴 Crítico | Muito Alta |
| 4.5 | Geração Sintegra | 🟡 Alto | Alta |
| 4.6 | Apuração de ICMS mensal | 🔴 Crítico | Alta |
| 4.7 | Apuração PIS/COFINS mensal | 🔴 Crítico | Alta |
| 4.8 | Relatório de produtos monofásicos | 🟡 Alto | Média |

### 28.5 Fase 5 — CT-e ⏱️ 4-6 semanas

| # | Item | Prioridade | Complexidade |
|---|------|-----------|-------------|
| 5.1 | Importação de CT-e XML | 🟡 Alto | Alta |
| 5.2 | Manifestação de CT-e | 🟡 Alto | Média |
| 5.3 | Escrituração de CT-e (Bloco D do SPED) | 🟡 Alto | Alta |
| 5.4 | Emissão de CT-e (se frota própria) | 🟢 Médio | Muito Alta |
| 5.5 | DACTE (PDF) | 🟢 Médio | Média |

### 28.6 Fase 6 — Reforma Tributária Completa ⏱️ Contínuo (2027-2033)

| # | Item | Prioridade | Complexidade |
|---|------|-----------|-------------|
| 6.1 | Split Payment (retenção automática) | 🟡 Futuro | Muito Alta |
| 6.2 | Convivência ICMS + IBS durante transição | 🟡 Futuro | Muito Alta |
| 6.3 | Extinção gradual PIS/COFINS → CBS | 🟡 Futuro | Alta |
| 6.4 | Imposto Seletivo por NCM | 🟡 Futuro | Média |
| 6.5 | Apuração IBS/CBS separada | 🟡 Futuro | Alta |

### 28.7 Estimativa de Esforço Total

| Fase | Prazo | Prioridade |
|------|-------|-----------|
| Fase 1 — Regime + Produtos | 2-3 semanas | 🔴 Fazer AGORA |
| Fase 2 — IBS/CBS básico | 3-4 semanas | 🔴 Antes de emitir NF-e em produção (LR/LP) |
| Fase 3 — Entrada de Notas | 4-6 semanas | 🔴 Essencial para operação |
| Fase 4 — Contábil-Fiscal | 6-8 semanas | 🔴 Obrigatório para compliance |
| Fase 5 — CT-e | 4-6 semanas | 🟡 Importante para indústria |
| Fase 6 — Reforma completa | Contínuo | 🟡 Acompanhar legislação |

**Total estimado:** ~6-8 meses para implementação completa de todas as fases.

---

> **Fim do Documento**  
> Versão 3.0 — Fevereiro 2026  
> Gerado automaticamente via análise estática do código-fonte ALUFORCE V.2  
> Atualizado com análise de compliance fiscal, reforma tributária e gaps identificados
