# 🏗 PLANO ESTRATÉGICO COMPLETO — WEB + API + MOBILE
## ALUFORCE ERP v2.1 → v3.0 (Padronização Enterprise)

**Data**: 19/02/2026  
**Versão do Plano**: 1.0  
**Status**: Aprovado para Execução  

---

## 📋 SUMÁRIO EXECUTIVO

Este documento define o plano completo de padronização arquitetural do ecossistema ALUFORCE, 
abrangendo Web (frontend/backend), API REST e aplicativo Mobile Android para equipe interna.

O objetivo é transformar o sistema atual — funcional mas com dívida técnica significativa — em uma 
plataforma enterprise preparada para escalar, evoluir e suportar o crescimento da empresa.

---

# 1️⃣ DIAGNÓSTICO ARQUITETURAL ATUAL

## 1.1 Estado Atual do Sistema Web

### Pontos Fortes ✅
- **Stack sólida**: Node.js + Express + MySQL 8.0 + Socket.IO
- **Módulos bem definidos**: Vendas, Financeiro, Compras, PCP, RH, NFe, Faturamento
- **Segurança avançada**: JWT, rate limiting (Redis), LGPD compliance, PII encryption
- **Infraestrutura production-ready**: PM2, Docker, ecosystem configs, VPS deployment
- **RBAC implementado**: Sistema DB-driven com fallback hardcoded (em transição)
- **Enterprise features**: Redis cache, Prometheus metrics, circuit breaker, query timeout

### Problemas Críticos Identificados 🔴

#### P1 — ACOPLAMENTO: Server monolítico (3.390 linhas)
- `server.js` concentra middlewares, configuração, auth e alguma lógica de negócio
- Dificulta manutenção, testes e onboarding de novos devs

#### P2 — AUTH FRAGMENTADA: 3 sistemas de login concorrentes
- `src/routes/auth.js` → POST /api/login (primary)
- `routes/auth-rbac.js` → POST /api/auth/login (RBAC)
- `middleware/auth-unified.js` → middleware (auditoria 15/02)
- Cada um gera JWT com payloads diferentes — risco de inconsistência

#### P3 — RESPOSTAS INCONSISTENTES: 3 padrões de resposta JSON
- Padrão A: `{ success: true, data: {...} }`
- Padrão B: `{ message: "...", ok: true }`
- Padrão C: Arrays diretos `[{...}]`
- Mobile **não pode** consumir API sem padrão previsível

#### P4 — DUPLICAÇÃO DE TABELAS: ~230 tabelas com sobreposição
- `estoque_movimentacoes` vs `estoque_movimentos` vs `movimentacoes_estoque` vs `stock_movements` (5 tabelas para mesma função)
- `centros_custo` vs `centro_custo`, `nfe` vs `nfes`
- Tabelas backup inline (`pedidos_backup_20260203`)

#### P5 — MÓDULOS COM SERVIDORES INDEPENDENTES
- Vendas (port 3000) tem seu próprio `server.js` (6.132 linhas!)
- Financeiro (port 3006) tem servidor separado
- Sem API gateway unificada para mobile consumir

#### P6 — SEM VERSIONAMENTO DE API
- Todos endpoints em `/api/*` sem versionamento
- Qualquer mudança pode quebrar clientes existentes
- Mobile precisa de API estável e versionada

#### P7 — PAGINAÇÃO INCONSISTENTE
- PCP usa `page/limit` 
- Vendas não tem paginação padrão
- Financeiro retorna tudo de uma vez em alguns endpoints

#### P8 — MIDDLEWARE DUPLICADO EM ROTAS
- `vendas-routes.js` e `financeiro-routes.js` aplicam `authenticateToken` e `authorizeArea` DUAS VEZES
- Overhead desnecessário em cada request

## 1.2 Gargalos de Performance
- Pool MySQL com 200 conexões (pode esgotar em picos)
- Queries sem paginação obrigatória em listagens
- Vendas `server.js` (6K+ linhas) carrega tudo em memória
- Sem CDN para assets estáticos (servidos pelo Express)

## 1.3 Problemas de Segurança
- Blocklist de funcionários demitidos hardcoded no código-fonte
- Tokens JWT com payloads diferentes entre auth systems
- CSRF exemptions amplas demais para mobile/webhook
- DeviceId gerado no login sem validação posterior

## 1.4 Problemas de Escalabilidade
- Banco monolítico single-schema para todos os módulos
- Sem database read replicas
- Rate limiting em memória em dev (apenas Redis em prod)
- Socket.IO sem Redis adapter em dev

---

# 2️⃣ PADRONIZAÇÃO WEB — O QUE PRECISA MUDAR

## 2.1 Separação Frontend / Backend

```
ANTES (v2.1):
  server.js → serve HTML + processa API + auth + regras

DEPOIS (v3.0):
  [Frontend SPA]  →  [API Gateway /v1]  →  [Services]  →  [MySQL]
       ↑                     ↑
   Módulos HTML          Versionada
   existentes           Padronizada
```

### Ações:
1. **API Gateway**: Criar camada `/api/v1/*` que centraliza todos endpoints
2. **Page Routes**: Manter `/pages/*` para servir HTML (sem regra de negócio)
3. **Services Layer**: Extrair lógica de negócio das routes para services/

## 2.2 Padrão de Consumo de API (Frontend)

```javascript
// PADRÃO OBRIGATÓRIO para todas as chamadas frontend
const API = {
  baseURL: '/api/v1',
  
  async request(method, endpoint, data = null) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AuthService.getToken()}`,
        'X-Device-Id': AuthService.getDeviceId(),
        'X-Request-Id': crypto.randomUUID()
      },
      body: data ? JSON.stringify(data) : null
    });
    
    if (response.status === 401) AuthService.handleExpiredToken();
    if (response.status === 403) AuthService.handleForbidden();
    
    return response.json(); // Sempre retorna { success, data, message, meta }
  }
};
```

## 2.3 Autenticação Unificada

**DECISÃO**: O `middleware/auth-unified.js` (auditoria 15/02/2026) será o ÚNICO sistema.

- **Deprecar**: `src/routes/auth.js` (login primary) — migrar para unified
- **Deprecar**: `routes/auth-rbac.js` (login RBAC) — migrar para unified
- **Manter**: `auth-unified.js` como fonte única de verdade

```
Login Flow (v3.0):
  POST /api/v1/auth/login → auth-unified → JWT (HS256, 8h)
  POST /api/v1/auth/refresh → auth-unified → novo JWT
  POST /api/v1/auth/logout → auth-unified → invalidar sessão
```

## 2.4 Versionamento de API

```
/api/v1/vendas/*          → versão atual (estável para mobile v1.0)
/api/v1/financeiro/*      → versão atual
/api/v1/compras/*         → versão atual
/api/v2/vendas/*          → futura (breaking changes)
```

**Regra**: v1 nunca recebe breaking changes após release do mobile.

## 2.5 Estrutura de Permissões (RBAC Final)

```
Perfis:
  ADMIN         → Acesso total a todos os módulos e ações
  DIRETOR       → Acesso total + aprovações de alto valor
  GERENTE       → Acesso aos módulos do departamento + aprovações
  COORDENADOR   → Acesso operacional + visualização cross-module
  ANALISTA      → CRUD no módulo + relatórios básicos
  OPERADOR      → Apenas operações do dia-a-dia
  CONSULTORIA   → Read-only cross-module
  
Ações por módulo:
  visualizar | criar | editar | excluir | aprovar | exportar | importar | configurar
```

---

# 3️⃣ PADRONIZAÇÃO DA API REST

## 3.1 Envelope de Resposta Padrão (OBRIGATÓRIO)

```json
// SUCESSO
{
  "success": true,
  "data": { ... },
  "message": "Operação realizada com sucesso",
  "meta": {
    "timestamp": "2026-02-19T14:30:00.000Z",
    "requestId": "uuid-v4",
    "version": "v1"
  }
}

// SUCESSO COM LISTA PAGINADA
{
  "success": true,
  "data": [ ... ],
  "message": null,
  "meta": {
    "pagination": {
      "page": 1,
      "perPage": 20,
      "total": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    },
    "filters": { "status": "ativo", "search": "cabo" },
    "sort": { "field": "created_at", "order": "desc" },
    "timestamp": "2026-02-19T14:30:00.000Z",
    "requestId": "uuid-v4"
  }
}

// ERRO
{
  "success": false,
  "data": null,
  "message": "Erro de validação nos dados enviados",
  "errors": [
    { "field": "email", "message": "Email inválido", "code": "INVALID_EMAIL" }
  ],
  "meta": {
    "timestamp": "2026-02-19T14:30:00.000Z",
    "requestId": "uuid-v4",
    "errorCode": "VALIDATION_ERROR"
  }
}
```

## 3.2 Códigos HTTP Padronizados

| Código | Quando Usar |
|--------|------------|
| 200 | GET com sucesso, PUT/PATCH com sucesso |
| 201 | POST criou recurso |
| 204 | DELETE com sucesso (sem body) |
| 400 | Validação falhou, dados inválidos |
| 401 | Token ausente ou expirado |
| 403 | Token válido mas sem permissão |
| 404 | Recurso não encontrado |
| 409 | Conflito (duplicata, constraint) |
| 422 | Entidade não processável (regra de negócio) |
| 429 | Rate limit excedido |
| 500 | Erro interno do servidor |
| 503 | Banco/serviço indisponível |

## 3.3 Paginação Padrão

```
GET /api/v1/vendas/pedidos?page=1&per_page=20&sort=created_at&order=desc&search=cabo&status=ativo

Parâmetros obrigatórios em endpoints de listagem:
  page       → default 1
  per_page   → default 20, max 100
  sort       → campo de ordenação
  order      → asc | desc
  search     → busca textual (LIKE)
  
Parâmetros de filtro são específicos por endpoint.
```

## 3.4 DTOs Padronizados (Data Transfer Objects)

```
Request DTOs:
  CreatePedidoDTO    → { cliente_id, itens[], observacoes, ... }
  UpdatePedidoDTO    → { status?, itens?, ... } (campos opcionais)
  
Response DTOs:
  PedidoResponseDTO  → { id, numero, cliente: { id, nome }, itens[], total, status, ... }
  PedidoListDTO      → { id, numero, cliente_nome, total, status, created_at }
  
Mappers:
  PedidoMapper.toResponse(dbRow)     → PedidoResponseDTO
  PedidoMapper.toListItem(dbRow)     → PedidoListDTO
  PedidoMapper.toEntity(createDTO)   → DB insert object
```

## 3.5 Middleware Chain Padrão

```
Request → [cors] → [helmet] → [rateLimit] → [auth] → [rbac] → [validate] → [handler] → [errorHandler] → Response
```

## 3.6 Endpoints RESTful (Nomenclatura)

```
CERTO:                              ERRADO:
GET    /api/v1/pedidos              GET    /api/getPedidos
GET    /api/v1/pedidos/:id          GET    /api/pedido?id=1
POST   /api/v1/pedidos              POST   /api/createPedido
PUT    /api/v1/pedidos/:id          POST   /api/updatePedido
PATCH  /api/v1/pedidos/:id/status   POST   /api/changeStatus
DELETE /api/v1/pedidos/:id          POST   /api/deletePedido
```

---

# 4️⃣ ESTRATÉGIA MOBILE

## 4.1 Módulos no App (Equipe Interna)

### FASE 1 — MVP (3 meses)
| Módulo | Motivo | Funcionalidades |
|--------|--------|----------------|
| **Dashboard** | Visão geral em qualquer lugar | KPIs, gráficos, alertas |
| **Vendas** | Equipe comercial em campo | Pedidos, clientes, orçamentos, follow-ups |
| **Notificações** | Alertas em tempo real | Push, aprovações pendentes |

### FASE 2 — Expansão (6 meses)
| Módulo | Motivo | Funcionalidades |
|--------|--------|----------------|
| **PCP** | Chão de fábrica | Ordens de produção, apontamentos, Kanban |
| **Compras** | Aprovação rápida | Cotações, pedidos, aprovações |
| **Financeiro** | Gestores | Contas a pagar/receber, fluxo de caixa |

### FASE 3 — Completo (12 meses)
| Módulo | Motivo | Funcionalidades |
|--------|--------|----------------|
| **RH** | Self-service | Ponto, holerites, férias |
| **NFe** | Fiscal mobile | Consulta DANFE, manifestação |
| **Chat** | Comunicação | Mensagens, suporte |

### Permanecem EXCLUSIVAMENTE Web:
- **Admin** → Gestão de usuários, roles, configurações
- **LGPD** → Compliance, consentimentos
- **Configurações do Sistema** → Deploy, migrations, backups
- **Relatórios pesados** → Gerenciais, exportação Excel/PDF em massa

## 4.2 Estratégia de Sincronização

```
[Mobile] ←→ [API v1] ←→ [MySQL]
   ↓                        ↓
[Room DB]              [Redis Cache]
(offline)              (distributed)
```

- **Online-first**: App sempre tenta API primeiro
- **Cache local**: Room DB para dados frequentes (clientes, produtos, pedidos recentes)
- **Sync incremental**: `?updated_after=2026-02-19T10:00:00Z` em listagens
- **Conflict resolution**: Server wins (última gravação no servidor prevalece)

## 4.3 Estratégia Offline

- **Leitura**: Dados cacheados em Room DB disponíveis offline
- **Escrita**: Fila de operações pendentes (WorkManager)
- **Sync automático**: Quando conexão restaurar, processa fila FIFO
- **Indicador visual**: Badge offline/online no app

## 4.4 Estratégia de Cache

| Dados | TTL | Storage |
|-------|-----|---------|
| Perfil do usuário | 24h | DataStore |
| Lista de clientes | 1h | Room DB |
| Catálogo de produtos | 4h | Room DB |
| Pedidos recentes | 15min | Room DB |
| Dashboard KPIs | 5min | Memory |
| Configurações | 24h | DataStore |

## 4.5 Estratégia de Segurança Mobile

1. **Token storage**: EncryptedSharedPreferences (Android Keystore)
2. **Certificate pinning**: SHA-256 do certificado SSL da VPS
3. **Root detection**: Detectar dispositivos rooted (alerta, não bloqueio)
4. **Biometria**: Opcional para relogin rápido (não substitui senha)
5. **Session timeout**: 30min inatividade → tela de relogin
6. **Logout remoto**: Via `sessoes_ativas` no banco
7. **Wipe remoto**: Flag no backend para forçar limpeza de dados locais

## 4.6 Estratégia de Sessão

```
Login → JWT (8h) + Refresh Token (30d)
  ↓
Token interceptor (Retrofit)
  ↓
401 → Tenta refresh automático
  ↓
Refresh falhou → Tela de login
```

- Máximo 3 devices simultâneos por usuário
- Tabela `sessoes_ativas` rastreia devices ativos
- Admin pode revogar sessões remotamente

## 4.7 Escalabilidade Futura

```
2026 Q2: Android nativo (Kotlin) — Este projeto
2026 Q3: Avaliar KMP (Kotlin Multiplatform) para iOS
2026 Q4: iOS nativo ou KMP shared module
2027 Q1: PWA como opção lightweight (Service Worker + Cache API)
2027 Q2: Avaliar migração para Flutter/KMP se necessário
```

---

# 5️⃣ MAPA DE FLUXOS

## 5.1 Fluxo de Autenticação (v3.0)

```
[App/Web] → POST /api/v1/auth/login { email, password, deviceId }
                         ↓
              [auth-unified middleware]
                         ↓
         Valida credenciais → bcrypt verify
                         ↓
         Verifica status (ativo/bloqueado/inativo)
                         ↓
         Gera JWT { userId, role, permissions, deviceId }
                         ↓
         Salva sessão em sessoes_ativas
                         ↓
         Retorna { token, refreshToken, user, permissions }
```

## 5.2 Fluxo por Perfil

```
ADMIN:
  Login → Dashboard (todos KPIs) → Qualquer módulo → CRUD completo + Aprovações + Config

GERENTE:
  Login → Dashboard (dept KPIs) → Módulos do dept → CRUD + Aprovações (até alçada)

COMERCIAL:
  Login → Dashboard Vendas → Pedidos → Clientes → Orçamentos → Follow-ups

OPERADOR PCP:
  Login → Dashboard PCP → Ordens Produção → Apontamentos → Kanban

FINANCEIRO:
  Login → Dashboard Financeiro → Contas Pagar/Receber → Fluxo Caixa → Conciliação
```

## 5.3 Fluxo Mobile Específico

```
[Splash] → [Login] → [Home/Dashboard]
                           ↓
               ┌───────────┼───────────┐
            [Vendas]   [PCP]    [Notificações]
               ↓          ↓           ↓
          [Pedidos]  [Ordens]   [Aprovações]
          [Clientes] [Kanban]   [Alertas]
```

---

# 6️⃣ ROADMAP DE EXECUÇÃO

## Sprint 1 (Semanas 1-2): Fundação API
- [ ] Criar camada `/api/v1/*` no backend
- [ ] Implementar response wrapper padronizado
- [ ] Unificar auth em `auth-unified.js`
- [ ] Implementar paginação padrão
- [ ] Criar endpoint `GET /api/v1/auth/me` (perfil + permissões)

## Sprint 2 (Semanas 3-4): App Android Fundação
- [ ] Projeto Android Studio (Clean Architecture)
- [ ] Camada de segurança (EncryptedSharedPreferences, JWT interceptor)
- [ ] Login funcional
- [ ] Dashboard básico

## Sprint 3 (Semanas 5-6): Vendas Mobile
- [ ] Lista de pedidos com paginação
- [ ] Detalhes do pedido
- [ ] Lista de clientes
- [ ] Criação de pedido

## Sprint 4 (Semanas 7-8): Polish & Release
- [ ] Notificações push (FCM)
- [ ] Pull-to-refresh em todas as listas
- [ ] Offline cache (Room)
- [ ] Testes
- [ ] Distribuição interna (APK/Firebase App Distribution)

---

# 7️⃣ DIAGRAMA DE ARQUITETURA

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ALUFORCE ECOSYSTEM v3.0                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Web SPA    │  │ Android App  │  │  iOS (futuro) │               │
│  │  (HTML/JS)  │  │  (Kotlin)    │  │  (KMP/Swift)  │               │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                │                  │                        │
│         └────────────────┼──────────────────┘                        │
│                          │                                           │
│              ┌───────────▼───────────┐                               │
│              │    NGINX (Reverse     │                               │
│              │    Proxy + SSL)       │                               │
│              └───────────┬───────────┘                               │
│                          │                                           │
│              ┌───────────▼───────────┐                               │
│              │    API GATEWAY        │                               │
│              │    /api/v1/*          │                               │
│              │                       │                               │
│              │  ┌─ Auth Middleware   │                               │
│              │  ├─ RBAC Middleware   │                               │
│              │  ├─ Rate Limiter     │                               │
│              │  ├─ Validator        │                               │
│              │  └─ Response Wrapper │                               │
│              └───────────┬───────────┘                               │
│                          │                                           │
│         ┌────────────────┼────────────────┐                          │
│         │                │                │                          │
│  ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼──────┐                   │
│  │  Services  │  │  Services  │  │  Services   │                   │
│  │  Vendas    │  │ Financeiro │  │  PCP/RH/... │                   │
│  └──────┬─────┘  └──────┬─────┘  └──────┬──────┘                   │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          │                                           │
│              ┌───────────▼───────────┐                               │
│              │     MySQL 8.0        │                               │
│              │  (aluforce_vendas)   │                               │
│              │  ~230 tabelas        │                               │
│              └───────────┬───────────┘                               │
│                          │                                           │
│              ┌───────────▼───────────┐                               │
│              │   Redis (Cache +     │                               │
│              │   Rate Limit +       │                               │
│              │   Socket.IO adapter) │                               │
│              └───────────────────────┘                               │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  ANDROID APP ARCHITECTURE (Clean Architecture + MVVM)                │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ Presentation Layer                                            │   │
│  │  ├─ Activities (host only)                                    │   │
│  │  ├─ Fragments (UI)                                            │   │
│  │  ├─ ViewModels (state management)                             │   │
│  │  └─ Adapters (RecyclerView)                                   │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ Domain Layer                                                  │   │
│  │  ├─ UseCases (business logic)                                 │   │
│  │  ├─ Models (entities puras)                                   │   │
│  │  └─ Repository Interfaces                                     │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ Data Layer                                                    │   │
│  │  ├─ Repository Implementations                                │   │
│  │  ├─ Remote (Retrofit + DTOs)                                  │   │
│  │  ├─ Local (Room + DAOs)                                       │   │
│  │  └─ Mappers (DTO ↔ Entity)                                   │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ Core                                                          │   │
│  │  ├─ DI (Hilt modules)                                         │   │
│  │  ├─ Security (Token, Encryption, CertPinning)                 │   │
│  │  ├─ Network (Interceptors, ErrorHandler)                      │   │
│  │  └─ Extensions & Utils                                        │   │
│  └───────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

# 8️⃣ GOVERNANÇA E EVOLUÇÃO

## 8.1 Estratégia de Evolução da API
- **Versionamento semântico**: MAJOR.MINOR.PATCH (3.0.0)
- **Deprecation policy**: Endpoints depreciados funcionam por 6 meses
- **Changelog**: Arquivo CHANGELOG.md atualizado a cada release
- **Contract testing**: Testes de contrato API para garantir compatibilidade

## 8.2 Estratégia de Manutenção
- **Hotfix**: < 24h para bugs críticos (segurança, data loss)
- **Bugfix**: Sprint atual para bugs normais
- **Feature**: Planejado em sprint planning
- **Tech debt**: 20% do sprint reservado para refatoração

## 8.3 Padrão de Documentação
- **API**: Swagger/OpenAPI 3.0 auto-gerado
- **Código**: JSDoc (backend) + KDoc (Android)
- **Arquitetura**: ADRs (Architecture Decision Records) em /docs
- **Runbook**: Guia operacional para deploy, troubleshooting, disaster recovery

## 8.4 Estratégia de Testes
- **Backend**: Jest/Mocha (unit) + Supertest (API) + Playwright (E2E)
- **Android**: JUnit5 (unit) + MockK (mocks) + Espresso (UI) + Hilt Testing
- **Cobertura mínima**: 60% unit, 40% integration para novos módulos
- **CI pipeline**: Testes obrigatórios antes de merge

## 8.5 Estratégia de Monitoramento
- **Prometheus metrics** (já implementado): HTTP latency, DB pool, cache hit rate
- **Logs estruturados**: Winston (backend) + Timber (Android)
- **Alertas**: Discord webhook para erros críticos (já existe discord-service.js)
- **APM mobile**: Firebase Crashlytics + Performance Monitoring

## 8.6 Estratégia para Escalar Usuários
- **Database**: Read replicas para queries pesadas (relatórios)
- **API**: Horizontal scaling com PM2 cluster mode (já configurado)
- **Cache**: Redis distribuído (já implementado)
- **CDN**: CloudFlare ou AWS CloudFront para assets estáticos
- **Connection pooling**: PgBouncer-like para MySQL (ProxySQL)

## 8.7 Expansão Futura
- **iOS**: Kotlin Multiplatform (shared domain/data layers)
- **SaaS externo**: Multi-tenancy via schema isolation ou tenant_id column
- **PWA**: Service Worker para acesso web mobile lightweight
- **Microservices**: Extrair módulos críticos (NFe, Financeiro) como serviços independentes

---

*Documento gerado como parte do projeto de padronização ALUFORCE v3.0*
*Próximo passo: Implementação do projeto Android (ETAPA 2)*
