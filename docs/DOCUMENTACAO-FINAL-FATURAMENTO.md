# ALUFORCE V.2 — Documentação Final do Sistema de Faturamento

> **ASSUNTO:** Modernização do Faturamento, Governança Fiscal e Segurança de Dados  
> **Versão do Sistema:** 2.1.7  
> **Data:** 24 de Fevereiro de 2026  
> **Plataforma:** Node.js 20 + Express + MySQL 8.0 + Socket.IO  
> **Infraestrutura:** VPS Ubuntu 22.04, PM2, TLS 1.2/1.3  

---

## 1. RESUMO EXECUTIVO

O **ALUFORCE V.2** é uma plataforma de gestão industrial modular projetada para escalar a operação da empresa, garantindo que o crescimento das vendas seja acompanhado por um rigoroso controle fiscal e financeiro.

A nova arquitetura elimina falhas de comunicação entre departamentos e automatiza o ciclo de vida completo do pedido — desde o orçamento até a entrega final e apuração fiscal. O sistema opera com **3 camadas de faturamento integradas**, controle de estoque unificado e comunicação direta com a SEFAZ para emissão de NF-e modelo 55 versão 4.00.

### Números do Sistema

| Métrica | Valor |
|---|---|
| Módulos ativos | 12 (Vendas, Faturamento, Estoque, Financeiro, PCP, Logística, NF-e, CT-e, Contábil, SPED, Compras, Dashboard) |
| Linhas de código fiscais | ~8.500+ (serviços de tributos, XML, SEFAZ, SPED, IBS/CBS) |
| Tabelas no banco de dados | 60+ (incluindo 6 fases de migração enterprise) |
| Endpoints de API | 200+ (com RBAC por endpoint) |
| Integrações externas | SEFAZ (13 UFs), PIX (4 gateways), SMTP, WhatsApp |

---

## 2. ARQUITETURA MODULAR E OPERAÇÃO

O sistema foi estruturado em módulos independentes, o que garante estabilidade: se um setor (como o Financeiro) passar por manutenção, os demais (Vendas e Expedição) continuam operando normalmente.

### 2.1 Módulos Operacionais

| Módulo | Função | Porta/Rota | Arquivo Principal |
|---|---|---|---|
| **Vendas** | Pipeline Kanban visual, orçamentos, pedidos | `/api/vendas/` | `routes/vendas-routes.js` (2.909 linhas) |
| **Faturamento Enterprise** | Emissão NF-e 4.00, SEFAZ, DANFE, PIX, Régua | `/api/faturamento/` | `modules/Faturamento/api/faturamento.js` (1.741 linhas) |
| **NF-e Legacy** | Emissão simplificada, impostos de serviço | `/api/nfe/` | `routes/nfe-routes.js` (360 linhas) |
| **Estoque** | Movimentações, reservas, baixas, rastreabilidade | Integrado via serviço | `vendas-estoque-integracao.service.js` (536 linhas) |
| **Financeiro** | Contas a receber/pagar, parcelas, PIX | `/api/financeiro/` | `financeiro-integracao.service.js` |
| **Logística** | Separação → Expedição → Transporte → Entrega | `/api/logistica/` | `routes/logistica-routes.js` (259 linhas) |
| **Contábil-Fiscal** | SPED EFD, apurações ICMS/PIS/COFINS | `/api/contabil-fiscal/` | `routes/api-contabil-fiscal.js` |
| **CT-e** | Conhecimento de Transporte eletrônico | `/api/cte/` | `routes/api-cte.js` |

### 2.2 Fluxo Operacional Completo

```
ORÇAMENTO → ANÁLISE → ANÁLISE CRÉDITO → APROVADO
                                            │
                    ┌───────────────────────┤
                    ▼                       ▼
            [Enterprise]              [Meia Nota F9]
           Gerar NF-e SEFAZ       Faturamento Parcial
           status → 'faturado'     status → 'parcial'
                    │                       │
                    │                 Remessa/Entrega
                    │                 status → 'faturado'
                    │                       │
                    └───────┬───────────────┘
                            ▼
                       LOGÍSTICA
              pendente → separação → expedição
                                        │
                                        ▼
                              TRANSPORTE → ENTREGUE
```

---

## 3. SISTEMA DE FATURAMENTO — 3 FLUXOS INTEGRADOS

### 3.1 Faturamento Enterprise (Principal)

O fluxo principal de faturamento é uma operação transacional completa com integração SEFAZ:

**Endpoint:** `POST /api/faturamento/gerar-nfe`

| Etapa | Descrição | Proteção |
|---|---|---|
| 1. RBAC | Verifica permissão fiscal do usuário | 9 gates de acesso por cargo |
| 2. Estoque | Valida disponibilidade via `VendasEstoqueIntegracaoService` | Bloqueante — não permite faturar sem estoque |
| 3. Pedido | Busca pedido com status `'aprovado'` + dados do cliente | `INNER JOIN clientes` |
| 4. Duplicata | Verifica se já existe NF-e para o pedido | Impede faturamento duplo |
| 5. Itens | Coleta todos os itens com NCM, unidade, preço | `INNER JOIN produtos` |
| 6. Numeração | `SELECT MAX(numero_nfe) FOR UPDATE` | Lock exclusivo anti-race condition |
| 7. Tributos | Cálculo ICMS, IPI, PIS, COFINS via `CalculoTributosService` | Aritmética BigInt de precisão |
| 8. NF-e | `INSERT INTO nfe` com status `'pendente'` | Transação MySQL |
| 9. XML | Gera XML NF-e 4.00 via `XmlNFeService` | **Falha = rollback total** (não cria NF-e sem XML) |
| 10. Pedido | `UPDATE pedidos SET status = 'faturado'` | Logística captura automaticamente |
| 11. Estoque | Reserva via `estoque_reservas` | Pós-commit, não bloqueante |
| 12. Financeiro | Gera parcelas em `contas_receber` | Pós-commit, configurável |

**Após autorização SEFAZ** (`POST /api/faturamento/nfes/:id/enviar-sefaz`):
- XML assinado com certificado A1
- Enviado ao WebService SEFAZ com retry exponencial
- Estoque **efetivamente baixado** (reserva → movimento de saída)
- Protocolo de autorização gravado no banco

### 3.2 Lógica de "Meia Nota" — Faturamento Parcial (F9)

Funcionalidade desenvolvida especificamente para projetos de longo prazo e vendas sob encomenda, permitindo separar o faturamento jurídico da entrega física em **duas fases**:

#### Fase 1 — Faturamento (Simples Faturamento)

**Endpoint:** `POST /api/vendas/pedidos/:id/faturamento-parcial`

```
Parâmetros aceitos:
├── tipo_faturamento: 'parcial_50' | 'entrega_futura' | 'consignado'
├── percentual: 1-100 (padrão 50%)
├── cfop: automático ou manual
├── gerarNFe: true (padrão)
├── gerarFinanceiro: true (padrão)
├── itens_faturar: [{produto_id, quantidade}]  ← NOVO: faturamento por item
└── observacoes: texto livre
```

**Dois modos de operação:**

| Modo | Descrição | Uso |
|---|---|---|
| **Por Percentual** | Fatura X% do valor total do pedido | Projetos com pagamento em marcos |
| **Por Item** | Seleciona itens específicos e quantidades | Entregas parciais de itens diferentes |

**Conformidade fiscal automática:**
- CFOP 5922/6922 (Simples Faturamento — Interna/Interestadual)
- CFOP 7922 (Zona Franca de Manaus)
- Status do pedido → `'parcial'` (< 100%) ou `'faturado'` (≥ 100%)
- **Estoque NÃO é baixado** nesta fase (conforme legislação de venda para entrega futura)

#### Fase 2 — Remessa / Entrega

**Endpoint:** `POST /api/vendas/pedidos/:id/remessa-entrega`

```
Validações obrigatórias:
├── Pedido deve estar em status 'parcial'
├── Estoque não pode ter sido baixado antes
├── Estoque suficiente para TODOS os itens (validação pré-transação)
│   └── Se insuficiente → ROLLBACK TOTAL com lista de problemas
└── Numeração NF-e unificada (MAX global de todas as séries)
```

**Na remessa:**
- CFOP 5117/6117 (Remessa por Conta e Ordem — Interna/Interestadual)
- CFOP 7117 (Zona Franca de Manaus)
- **Estoque É baixado** (`UPDATE produtos SET estoque_atual = estoque_atual - ?`)
- Sincronização automática com tabela `estoque` (Enterprise)
- Status do pedido → `'faturado'`
- Registro em `estoque_movimentos` para auditoria

#### Vantagens da Meia Nota

| Benefício | Descrição |
|---|---|
| **Fluxo de Caixa** | Antecipa receita sem necessidade de entrega física imediata |
| **Segurança Jurídica** | NF-e de simples faturamento tem validade fiscal plena |
| **Conformidade** | CFOPs automáticos conforme operação (5922→5117, 6922→6117, 7922→7117) |
| **Rastreabilidade** | Tabela `pedido_faturamentos` registra cada etapa com usuário, data e valores |
| **Estoque Inteligente** | Baixa apenas na entrega real, não no faturamento jurídico |
| **Faturamento por Item** | Permite selecionar quais itens e quantidades faturar (não apenas % do total) |

### 3.3 Faturamento Simplificado (Legacy NF-e)

Mantido para compatibilidade com operações de serviço:

**Endpoint:** `POST /api/nfe/emitir`

- Emissão direta com impostos de serviço (ISS, PIS, COFINS, CSLL, IRRF)
- Integração com estoque de materiais (tabela `materiais`)
- Sincronização automática com `produtos.estoque_atual` e tabela `estoque`
- Cancelamento restaura pedido a `'aprovado'` (pode ser re-faturado)

---

## 4. MOTOR FISCAL E TRIBUTÁRIO

### 4.1 Precisão Matemática

Diferente de softwares genéricos que usam `float` (IEEE 754), o ALUFORCE utiliza um motor de cálculo de alta precisão:

| Componente | Tecnologia | Arquivo |
|---|---|---|
| **Classe Decimal** | BigInt com escala 10^10 | `calculo-tributos.service.js` |
| **Arredondamento** | ABNT NBR 5891 (banker's rounding) | Integrado ao Decimal |
| **Validação** | Fail-fast — rejeita NCM/CFOP/GTIN inválidos antes do cálculo | `ValidacaoFiscal` |
| **Proteção float** | `Math.round(... * 100) / 100` em todos os valores monetários | Endpoints de vendas |

**Exemplo de precisão:**
```
Cálculo ICMS: R$ 1.234,57 × 18% = R$ 222,2226
→ float JavaScript: 222.22259999999997 (ERRADO)
→ Decimal BigInt: 222.22 (CORRETO, arredondamento banker's)
```

### 4.2 Tributos Calculados

| Tributo | Base | Motor |
|---|---|---|
| ICMS | Valor produto - desconto | `CalculoTributosService` com regime da empresa (Simples/Presumido/Real) |
| IPI | Valor produto | Alíquota por NCM |
| PIS | Receita bruta | 0,65% (cumulativo) ou 1,65% (não-cumulativo) |
| COFINS | Receita bruta | 3% (cumulativo) ou 7,6% (não-cumulativo) |
| ISS | Valor serviço | 2-5% conforme município |
| IBS/CBS | Valor operação | **Reforma Tributária** — conforme cronograma de transição 2026-2033 |

### 4.3 Reforma Tributária (IBS/CBS) — Pronto

O sistema já implementa o serviço `IBSCBSService` conforme NT 2025.002 e Ato Conjunto RFB/CGIBS nº 01/2025:

| Ano | IBS | ICMS | Status no Sistema |
|---|---|---|---|
| 2026 | 10% | 90% | ✅ Implementado |
| 2027 | 20% | 80% | ✅ Implementado |
| 2028 | 30% | 70% | ✅ Implementado |
| 2029 | 40% | 60% | ✅ Implementado |
| 2030 | 60% | 40% | ✅ Implementado |
| 2031 | 80% | 20% | ✅ Implementado |
| 2032 | 90% | 10% | ✅ Implementado |
| 2033 | 100% | Extinto | ✅ Implementado |

---

## 5. COMUNICAÇÃO SEFAZ E DOCUMENTOS FISCAIS

### 5.1 NF-e 4.00

| Componente | Implementação |
|---|---|
| **Geração XML** | `XmlNFeService` — xmlbuilder2, NF-e v4.00 |
| **Assinatura** | Certificado digital A1 (PFX/P12), `node-forge` para PKCS#12 |
| **Envio** | `SefazService` — SOAP com TLS 1.2/1.3, retry exponencial (3 tentativas) |
| **Autorizadores** | 13 UFs suportadas com URLs de produção e homologação |
| **Eventos** | Cancelamento (24h), Carta de Correção (CC-e), Inutilização |
| **DANFE** | Geração de PDF para impressão/envio |

### 5.2 CT-e (Conhecimento de Transporte)

| Componente | Implementação |
|---|---|
| **XML CT-e** | `CteService` — modelo 57, v4.00 |
| **Validação** | CNPJ/CPF, placas, RNTRC, peso vs. capacidade |
| **ICMS** | Normal, SN, Isento com alíquotas por UF |
| **Gestão** | CRUD completo de veículos e motoristas |

### 5.3 SPED Fiscal

| Componente | Implementação |
|---|---|
| **EFD ICMS/IPI** | `SpedFiscalService` — Layout v017 (vigente 2025+) |
| **EFD Contribuições** | `SpedContribuicoesService` — PIS/COFINS |
| **SINTEGRA** | `SintegraService` — Arquivo magnético |
| **Apurações** | Cálculo automático de créditos/débitos mensais |

### 5.4 CFOP Inteligente

O sistema detecta automaticamente o CFOP correto baseado na operação:

| Operação | Interna (5xxx) | Interestadual (6xxx) | Zona Franca (7xxx) |
|---|---|---|---|
| Venda Normal | 5102 | 6102 | 7102 |
| Simples Faturamento | 5922 | 6922 | 7922 |
| Remessa Entrega Futura | 5117 | 6117 | 7117 |

**Detecção automática:**
- UF empresa vs. UF cliente → Interna ou Interestadual
- UF cliente em [AM, RR, AP, AC, RO] → Zona Franca de Manaus (Decreto 288/67)

---

## 6. INTEGRAÇÃO COM ESTOQUE

### 6.1 Sistema Unificado

Após modernização, os 3 fluxos de faturamento agora sincronizam o estoque em todas as tabelas:

| Tabela | Coluna | Atualizada por |
|---|---|---|
| `produtos` | `estoque_atual` | Enterprise, Vendas (Parcial), Legacy NF-e |
| `estoque` | `quantidade_disponivel`, `quantidade_reservada` | Enterprise, Vendas (Parcial), Legacy NF-e |
| `materiais` | `quantidade_estoque` | Legacy NF-e (tabela original) |
| `estoque_movimentos` | Histórico de movimentações | Todos os fluxos |
| `estoque_reservas` | Reservas ativas | Enterprise (gerar-nfe) |

### 6.2 Proteção contra Estoque Negativo

| Fluxo | Proteção |
|---|---|
| **Enterprise** | Validação pré-faturamento via `VendasEstoqueIntegracaoService` |
| **Parcial (Remessa)** | Validação completa com **ROLLBACK da transação** se insuficiente |
| **Legacy NF-e** | `WHERE quantidade_estoque >= ?` — bloqueia emissão |

### 6.3 Ciclo de Vida do Estoque

```
Pedido Aprovado
    │
    ├─ Enterprise: gerar-nfe → RESERVA estoque
    │   └─ SEFAZ autoriza → BAIXA efetiva (reserva → saída)
    │
    ├─ Meia Nota: faturamento-parcial → SEM MOVIMENTO de estoque
    │   └─ remessa-entrega → BAIXA efetiva (validada, com rollback)
    │
    └─ Legacy: emitir → BAIXA imediata (validada)
    
Cancelamento → ESTORNO automático em todas as tabelas
```

---

## 7. INTEGRAÇÃO FINANCEIRA

### 7.1 Contas a Receber

Geradas automaticamente em cada operação de faturamento:

| Operação | Tipo no Financeiro | Vencimento |
|---|---|---|
| Gerar NF-e (Enterprise) | Parcelas configuráveis (nº, intervalo, dia) | Conforme parâmetros |
| Faturamento Parcial | `'faturamento_parcial'` | +30 dias |
| Remessa/Entrega | `'remessa_entrega'` | +30 dias |
| Legacy NF-e | `'pendente'` | Data informada |

### 7.2 Gateway PIX

4 provedores integrados para cobrança instantânea:

| Provedor | Status |
|---|---|
| Banco do Brasil | ✅ Implementado |
| Sicoob | ✅ Implementado |
| EfiBank (ex-Gerencianet) | ✅ Implementado |
| Mercado Pago | ✅ Implementado |

Funcionalidades: cobrança PIX por NF-e, cobrança por conta a receber, consulta, cancelamento, webhook para confirmação automática, dashboard de cobranças.

### 7.3 Régua de Cobrança Automatizada

Sistema de lembretes e cobranças programadas:
- Envio automático por e-mail (SMTP configurável)
- Templates de mensagens personalizáveis
- Histórico completo de comunicações
- Dashboard com métricas de inadimplência

---

## 8. LOGÍSTICA

### 8.1 Pipeline de Entrega

O módulo de logística captura automaticamente pedidos com `status = 'faturado'`:

```
FATURADO → Pendente/Ag. Separação → Em Separação → Em Expedição → Em Transporte → ENTREGUE
```

| Endpoint | Função |
|---|---|
| `GET /api/logistica/dashboard` | Contagem por status logístico |
| `GET /api/logistica/pedidos` | Lista com filtros (status, data, cliente) |
| `PUT /api/logistica/pedidos/:id/status` | Avança status logístico |
| `PUT /api/logistica/pedidos/:id/transportadora` | Atribui transportadora |
| `POST /api/logistica/expedicao` | Cria expedição manual |

Quando a entrega é confirmada, o status principal do pedido muda para `'entregue'`.

---

## 9. GOVERNANÇA E SEGURANÇA

### 9.1 Controle de Acesso (RBAC)

O sistema implementa **9 gates de RBAC** somente no módulo de faturamento:

| Operação | Cargos Permitidos |
|---|---|
| Gerar NF-e | admin, gerente, gerente_fiscal, faturista, fiscal, supervisor_fiscal |
| Cancelar NF-e | admin, gerente, gerente_fiscal, supervisor_fiscal |
| Enviar à SEFAZ | admin, gerente, gerente_fiscal, faturista, fiscal |
| Carta de Correção | admin, gerente, gerente_fiscal, faturista |
| Inutilizar Numeração | admin, gerente_fiscal |
| Configurar Certificado | admin |
| Configurar PIX | admin, gerente, gerente_financeiro |
| Configurar Régua | admin, gerente |
| Alterar Templates | admin, gerente |

Cada tentativa de acesso não autorizado é logada com o ID do usuário, cargo e operação tentada.

### 9.2 Segurança de Infraestrutura

| Camada | Implementação |
|---|---|
| **Rate Limiting** | 3.000 req/15min (produção), Redis Store para cluster |
| **Helmet** | Headers de segurança HTTP |
| **CORS** | Configuração restritiva por origem |
| **TLS** | 1.2 e 1.3 para comunicação SEFAZ |
| **Certificado A1** | PFX/P12 com `node-forge`, chave privada nunca exposta |
| **JWT** | Tokens com expiração para autenticação de API |

### 9.3 LGPD

O módulo `lgpd-crypto.js` implementa criptografia AES-256-GCM com chave derivada por PBKDF2 para dados pessoais sensíveis (CPF, CNPJ, salários).

### 9.4 Auditoria e Rastreabilidade

| O que é registrado | Onde |
|---|---|
| Toda geração de NF-e | `[FATURAMENTO-AUDIT]` no log + campo `usuario_id` no banco |
| Toda alteração de pedido | Tabela `pedido_historico` com ação, descrição e metadados JSON |
| Cada etapa de faturamento parcial | Tabela `pedido_faturamentos` com sequência, tipo, valor, NF, CFOP |
| Movimentações de estoque | Tabelas `estoque_movimentos` e `estoque_movimentacoes` com referência |
| Envio à SEFAZ | Protocolo, data, usuário, XML assinado |
| Cancelamentos | Motivo obrigatório (15-255 caracteres), prazo de 24h |

---

## 10. DIFERENCIAIS ESTRATÉGICOS

### 10.1 Numeração NF-e Unificada

Todos os fluxos de faturamento (Enterprise, Parcial, Remessa) usam uma **sequência global única**, calculada como `MAX(MAX(nfe.numero_nfe), MAX(pedidos.nfe_faturamento_numero), MAX(pedidos.nfe_remessa_numero)) + 1` com `FOR UPDATE` lock. Isso elimina o risco de numeração duplicada.

### 10.2 Transações Atômicas

Toda operação fiscal é envolta em transação MySQL com:
- `BEGIN TRANSACTION` antes de qualquer operação
- `FOR UPDATE` lock nos registros críticos (pedido, numeração)
- `COMMIT` apenas quando TUDO deu certo
- `ROLLBACK` automático em qualquer falha (incluindo XML)
- `connection.release()` garantido no `finally`

### 10.3 Cancelamento Consistente

Antes da modernização, cancelar uma NF-e pelo fluxo Legacy mudava o pedido para `'cancelado'` (irreversível), enquanto o Enterprise apenas limpava o `nfe_id`. Agora, **ambos os fluxos** restauram o pedido para `'aprovado'`, permitindo re-faturamento.

### 10.4 Reforma Tributária 2026-2033

O sistema já está preparado para a transição IBS/CBS, com:
- Tabela de cronograma de transição (IBS progressivo, ICMS regressivo)
- Serviço `IBSCBSService` com cálculos conforme Lei Complementar 214/2025
- Integração condicional no XML da NF-e (campo IBS/CBS quando habilitado)
- Classificação tributária por produto

---

## 11. CONCLUSÃO E PRÓXIMOS PASSOS

A versão 2.1.7 coloca a Aluforce em um novo patamar de maturidade digital, com:

✅ **Faturamento completo** — NF-e 4.00 integrada à SEFAZ com assinatura A1  
✅ **Meia nota operacional** — Faturamento parcial por % ou por item, com 2 fases (faturamento + remessa)  
✅ **Estoque unificado** — Todas as tabelas sincronizadas, com validação e rollback  
✅ **Numeração segura** — Sequência global com lock anti-race condition  
✅ **CFOP inteligente** — Detecção automática de operação interna, interestadual e Zona Franca  
✅ **Conformidade fiscal** — Motor de precisão BigInt, SPED EFD, IBS/CBS, CT-e  
✅ **Financeiro integrado** — Parcelas automáticas, PIX (4 gateways), régua de cobrança  
✅ **Logística integrada** — Pipeline automático de separação à entrega  
✅ **Segurança enterprise** — RBAC, rate limiting, TLS, auditoria completa  

### Roadmap Q2 2026

| Prioridade | Item | Status |
|---|---|---|
| Alta | Dashboards de BI para decisão da diretoria | Planejado |
| Alta | MD-e (Manifestação do Destinatário) completa com SEFAZ | Em implementação |
| Média | NF de entrada com escrituração automática de créditos | Módulo criado, aguardando testes |
| Média | Integração contábil com exportação para sistemas ECD/ECF | Planejado |
| Baixa | App mobile para aprovação de pedidos | Planejado |
| Baixa | Integração com marketplaces (B2W, Mercado Livre) | Futuro |

---

> **Documento gerado em:** 24/02/2026  
> **Sistema:** ALUFORCE v2.1.7  
> **Autor:** Equipe de Engenharia ALUFORCE  
