# 🏢 ANÁLISE COMPLETA END-TO-END MULTI-COMPANY
## Auditoria de Padronização e Conformidade: Aluforce | Labor Energy | Labor Eletric

---

## 📋 CONTEXTO E OBJETIVO

Você é um **Senior Software Architect**, **QA Lead** e **Multi-Tenant Systems Specialist** responsável por realizar uma **análise completa ponta a ponta** de um sistema ERP multi-company.

### Sistema Analisado
- **Nome:** Zyntra ERP v2.4.0
- **Arquitetura:** Multi-tenant com bancos de dados isolados
- **Tecnologias:** Node.js, Express, MySQL, Socket.io, Puppeteer

### Empresas no Sistema
1. **Aluforce** (Principal)
   - Porta: 3000
   - Banco: `aluforce_vendas`
   - Status: Sistema base/referência

2. **Labor Energy**
   - Porta: 4002 (config) / 3002 (real)
   - Banco: `labor_energy_vendas`
   - CNPJ: 53.937.474/0001-20

3. **Labor Eletric**
   - Porta: 4001 (config) / 3001 (real)
   - Banco: `labor_eletric_vendas`
   - CNPJ: 35.165.246/0001-06

---

## 🎯 OBJETIVO PRINCIPAL

Realizar uma **análise comparativa completa** das 3 empresas para:

1. ✅ **Verificar padronização** - Todas as empresas devem ter os mesmos módulos e funcionalidades
2. ✅ **Identificar inconsistências** - Detectar diferenças de implementação entre empresas
3. ✅ **Validar isolamento de dados** - Garantir que não há vazamento de dados entre empresas
4. ✅ **Testar funcionalidades** - Verificar se todos os módulos estão funcionando corretamente
5. ✅ **Gerar arquivo de correção** - Criar um único arquivo Markdown com TODAS as correções necessárias

---

## 📊 MÓDULOS A ANALISAR

Analise **TODOS** os módulos em **TODAS** as 3 empresas:

### Módulos Core (Obrigatórios)

1. **Dashboard** - Visão geral, KPIs, gráficos
2. **Vendas** - Orçamentos, pedidos, comissões
3. **Faturamento** - NFe, DANFE, transmissão SEFAZ
4. **Financeiro** - Contas a pagar/receber, fluxo de caixa
5. **PCP** - Planejamento e Controle de Produção
6. **Compras** - Pedidos de compra, fornecedores
7. **Estoque** - Produtos, movimentações, inventário
8. **RH** - Funcionários, folha de pagamento, holerites
9. **Admin** - Usuários, permissões, configurações
10. **Relatórios** - Todos os relatórios do sistema
11. **Logística** - Expedição, transportadoras, rastreamento
12. **CRM** - Clientes, prospecção, follow-up

### Funcionalidades Transversais
- **Autenticação** - Login, logout, sessões
- **Autorização** - Permissões por módulo e ação
- **Chat** - Sistema de chat em tempo real
- **Notificações** - Alertas e avisos
- **Upload de Arquivos** - Imagens, documentos, anexos
- **Exportação** - PDF, Excel, CSV
- **Impressão** - Relatórios, documentos fiscais

---

## 🔍 CRITÉRIOS DE ANÁLISE

### 1. PADRONIZAÇÃO DE MÓDULOS

Para cada módulo, verificar em TODAS as 3 empresas:

#### ✅ Presença do Módulo
- [ ] Módulo existe e está acessível
- [ ] Rota está configurada corretamente
- [ ] Menu/sidebar exibe o módulo
- [ ] Permissões estão configuradas

#### ✅ Funcionalidade Completa
- [ ] CRUD completo (Create, Read, Update, Delete)
- [ ] Listagem com paginação funcionando
- [ ] Filtros e busca operacionais
- [ ] Formulários validando corretamente
- [ ] Modais abrindo e fechando
- [ ] Botões executando ações esperadas

#### ✅ Interface Consistente
- [ ] Layout idêntico entre empresas
- [ ] Mesmos campos nos formulários
- [ ] Mesmas colunas nas tabelas
- [ ] Mesmos botões e ações
- [ ] Mesmos textos e labels

#### ✅ Backend Funcional
- [ ] APIs respondendo corretamente
- [ ] Queries retornando dados
- [ ] Validações funcionando
- [ ] Erros sendo tratados
- [ ] Logs sendo gerados

---

### 2. ISOLAMENTO DE DADOS

Verificar que **NÃO HÁ VAZAMENTO** de dados entre empresas:


#### 🔒 Testes de Isolamento
1. **Dados de Clientes**
   - Clientes da Aluforce NÃO aparecem na Labor Energy
   - Clientes da Labor Energy NÃO aparecem na Labor Eletric
   - Cada empresa vê apenas seus próprios clientes

2. **Dados de Vendas**
   - Pedidos isolados por empresa
   - Orçamentos isolados por empresa
   - Comissões calculadas apenas para vendedores da empresa

3. **Dados Financeiros**
   - Contas a pagar/receber isoladas
   - Fluxo de caixa separado
   - Relatórios financeiros filtrados por empresa

4. **Dados de Estoque**
   - Produtos isolados (ou compartilhados conforme regra de negócio)
   - Movimentações isoladas por empresa
   - Inventário separado

5. **Sessões e Autenticação**
   - Login em uma empresa NÃO dá acesso a outra
   - Tokens JWT específicos por empresa
   - Cookies isolados por domínio/porta

---

### 3. BRANDING E IDENTIDADE VISUAL

Cada empresa deve ter sua **identidade visual correta**:

#### 🎨 Elementos de Branding
- [ ] **Logo** - Logo correto da empresa em sidebar, header, relatórios
- [ ] **Nome da Empresa** - Razão social correta em todos os lugares
- [ ] **CNPJ** - CNPJ correto em documentos fiscais e relatórios
- [ ] **Cores** - Paleta de cores da empresa (se aplicável)
- [ ] **Favicon** - Ícone correto na aba do navegador
- [ ] **Título da Página** - Nome correto no `<title>`

#### 📄 Documentos e Templates
- [ ] **Orçamentos** - Cabeçalho com logo e dados da empresa
- [ ] **Pedidos** - Identificação correta da empresa
- [ ] **NFe/DANFE** - Dados fiscais corretos
- [ ] **Relatórios PDF** - Branding consistente
- [ ] **Emails** - Assinatura e identidade da empresa

---

### 4. PERFORMANCE E ESTABILIDADE

Comparar performance entre as 3 empresas:

#### ⚡ Métricas de Performance
- [ ] **Tempo de carregamento do Dashboard** - Deve ser similar (±20%)
- [ ] **Tempo de resposta das APIs** - Deve ser similar (±20%)
- [ ] **Tempo de geração de relatórios** - Deve ser similar (±30%)
- [ ] **Uso de memória** - Deve ser proporcional ao volume de dados

#### 🛡️ Estabilidade
- [ ] **Sem erros 500** - Nenhum erro interno do servidor
- [ ] **Sem erros 404** - Todas as rotas existem
- [ ] **Sem erros de console** - JavaScript sem erros
- [ ] **Sem memory leaks** - Memória estável ao longo do tempo

---

### 5. SEGURANÇA E CONFORMIDADE

Verificar aspectos de segurança em TODAS as empresas:


#### 🔐 Checklist de Segurança
- [ ] **Autenticação obrigatória** - Rotas protegidas exigem login
- [ ] **Autorização por módulo** - Permissões respeitadas
- [ ] **CSRF Protection** - Token CSRF validado
- [ ] **SQL Injection** - Queries parametrizadas
- [ ] **XSS Protection** - Inputs sanitizados
- [ ] **Rate Limiting** - Proteção contra brute force
- [ ] **HTTPS** - Conexão segura (em produção)
- [ ] **Senhas criptografadas** - bcrypt com salt adequado

---

## 🔧 METODOLOGIA DE ANÁLISE

### Fase 1: Análise Estática (Código-Fonte)

1. **Estrutura de Arquivos**
   ```bash
   # Verificar se estrutura é idêntica
   - /modules/Dashboard/
   - /modules/Vendas/
   - /modules/Faturamento/
   - /modules/Financeiro/
   - /modules/PCP/
   - /modules/Compras/
   - /modules/Estoque/
   - /modules/RH/
   - /modules/Admin/
   - /modules/Relatorios/
   ```

2. **Configurações por Empresa**
   ```bash
   # Verificar arquivos de configuração
   - ecosystem.config.js (Aluforce - porta 3000)
   - ecosystem.labor-energy.config.js (porta 3002)
   - ecosystem.labor-eletric.config.js (porta 3001)
   ```

3. **Rotas e Endpoints**
   ```bash
   # Verificar se todas as rotas existem
   - /api/dashboard/*
   - /api/vendas/*
   - /api/faturamento/*
   - /api/financeiro/*
   - /api/pcp/*
   - /api/compras/*
   - /api/estoque/*
   - /api/rh/*
   - /api/admin/*
   - /api/relatorios/*
   ```

### Fase 2: Análise Dinâmica (Testes Funcionais)

1. **Teste de Login**
   - Fazer login em cada empresa
   - Verificar se sessão é isolada
   - Testar logout

2. **Teste de Navegação**
   - Acessar cada módulo
   - Verificar se carrega corretamente
   - Verificar se dados são exibidos

3. **Teste de CRUD**
   - Criar registro em cada empresa
   - Listar registros
   - Editar registro
   - Excluir registro
   - Verificar isolamento

4. **Teste de Relatórios**
   - Gerar relatório em cada empresa
   - Verificar branding correto
   - Verificar dados corretos

### Fase 3: Análise de Banco de Dados

1. **Estrutura de Tabelas**
   ```sql
   -- Verificar se estrutura é idêntica
   SHOW TABLES FROM aluforce_vendas;
   SHOW TABLES FROM labor_energy_vendas;
   SHOW TABLES FROM labor_eletric_vendas;
   ```

2. **Integridade de Dados**
   ```sql
   -- Verificar se não há referências cruzadas
   SELECT * FROM aluforce_vendas.clientes WHERE id IN (
     SELECT cliente_id FROM labor_energy_vendas.vendas
   ); -- Deve retornar 0 linhas
   ```

---

## 📝 FORMATO DO ARQUIVO DE CORREÇÃO

Gerar arquivo: **`CORRECOES-MULTI-COMPANY-COMPLETO.md`**

### Estrutura do Arquivo


```markdown
# 🔧 CORREÇÕES MULTI-COMPANY - ZYNTRA ERP
## Análise Completa End-to-End | Data: [DATA_ATUAL]

---

## 📊 RESUMO EXECUTIVO

### Estatísticas Gerais
- **Total de Módulos Analisados:** 12
- **Total de Testes Executados:** [NÚMERO]
- **Taxa de Sucesso Global:** [PERCENTUAL]%
- **Inconsistências Encontradas:** [NÚMERO]
- **Severidade Crítica:** [NÚMERO]
- **Severidade Alta:** [NÚMERO]
- **Severidade Média:** [NÚMERO]
- **Severidade Baixa:** [NÚMERO]

### Status por Empresa

| Empresa | Módulos OK | Módulos com Erro | Taxa de Sucesso |
|---------|------------|------------------|-----------------|
| Aluforce | X/12 | Y/12 | Z% |
| Labor Energy | X/12 | Y/12 | Z% |
| Labor Eletric | X/12 | Y/12 | Z% |

---

## 📋 MATRIZ DE COMPARAÇÃO DETALHADA

| Módulo | Aluforce | Labor Energy | Labor Eletric | Status | Prioridade |
|--------|----------|--------------|---------------|--------|------------|
| Dashboard | ✅ OK | ✅ OK | ⚠️ PARCIAL | ATENÇÃO | MÉDIA |
| Vendas | ✅ OK | ❌ FALHA | ❌ AUSENTE | CRÍTICO | ALTA |
| Faturamento | ✅ OK | ✅ OK | ✅ OK | OK | - |
| Financeiro | ✅ OK | ❌ AUSENTE | ❌ AUSENTE | CRÍTICO | ALTA |
| PCP | ✅ OK | ❌ AUSENTE | ⚠️ PARCIAL | CRÍTICO | ALTA |
| Compras | ✅ OK | ✅ OK | ✅ OK | OK | - |
| Estoque | ✅ OK | ⚠️ PARCIAL | ⚠️ PARCIAL | ATENÇÃO | MÉDIA |
| RH | ✅ OK | ⚠️ LIMITADO | ⚠️ LIMITADO | ATENÇÃO | MÉDIA |
| Admin | ✅ OK | ✅ OK | ✅ OK | OK | - |
| Relatórios | ✅ OK | ⚠️ PARCIAL | ⚠️ PARCIAL | ATENÇÃO | MÉDIA |
| Logística | ✅ OK | ❌ AUSENTE | ❌ AUSENTE | CRÍTICO | ALTA |
| CRM | ✅ OK | ❌ AUSENTE | ❌ AUSENTE | CRÍTICO | ALTA |

**Legenda:**
- ✅ **OK** - Módulo presente e 100% funcional
- ⚠️ **PARCIAL** - Módulo presente mas com funcionalidades limitadas
- ⚠️ **LIMITADO** - Módulo presente mas com bugs ou erros
- ❌ **FALHA** - Módulo presente mas não funcional
- ❌ **AUSENTE** - Módulo não existe

---

## 🚨 INCONSISTÊNCIAS CRÍTICAS

### 🔴 PRIORIDADE CRÍTICA (Resolver em 0-24h)

#### ERRO #1: Módulo Financeiro Ausente em Labor Energy e Labor Eletric

**Descrição:**
O módulo Financeiro está presente e funcional na Aluforce, mas está completamente ausente nas empresas Labor Energy e Labor Eletric.

**Impacto:**
- ❌ Impossível gerenciar contas a pagar/receber
- ❌ Sem controle de fluxo de caixa
- ❌ Relatórios financeiros indisponíveis
- ❌ Negócio não pode operar financeiramente

**Empresas Afetadas:**
- Labor Energy (porta 3002)
- Labor Eletric (porta 3001)

**Arquivos Envolvidos:**
- `/modules/Financeiro/` (ausente)
- `/routes/financeiro.js` (ausente)
- `server.js` (rota não registrada)

**Solução:**

1. **Copiar módulo da Aluforce:**
   ```bash
   # Criar estrutura para Labor Energy
   mkdir -p Base/Labor-Energy/modules/Financeiro
   cp -r modules/Financeiro/* Base/Labor-Energy/modules/Financeiro/
   
   # Criar estrutura para Labor Eletric
   mkdir -p Base/Labor-Eletric/modules/Financeiro
   cp -r modules/Financeiro/* Base/Labor-Eletric/modules/Financeiro/
   ```

2. **Registrar rotas no server.js:**
   ```javascript
   // Labor Energy
   if (process.env.BRAND === 'labor-energy') {
     app.use('/api/financeiro', require('./routes/financeiro'));
   }
   
   // Labor Eletric
   if (process.env.BRAND === 'labor-eletric') {
     app.use('/api/financeiro', require('./routes/financeiro'));
   }
   ```

3. **Configurar permissões:**
   ```sql
   -- Labor Energy
   INSERT INTO labor_energy_vendas.modulos (nome, descricao, icone, ordem)
   VALUES ('Financeiro', 'Gestão Financeira', 'fa-dollar-sign', 4);
   
   -- Labor Eletric
   INSERT INTO labor_eletric_vendas.modulos (nome, descricao, icone, ordem)
   VALUES ('Financeiro', 'Gestão Financeira', 'fa-dollar-sign', 4);
   ```

4. **Testar funcionalidade:**
   ```bash
   # Reiniciar servidores
   pm2 restart labor-energy-production
   pm2 restart labor-eletric-production
   
   # Testar acesso
   curl http://localhost:3002/api/financeiro/contas-receber
   curl http://localhost:3001/api/financeiro/contas-receber
   ```

**Validação:**
- [ ] Módulo aparece no menu sidebar
- [ ] Rota `/financeiro` carrega corretamente
- [ ] CRUD de contas a pagar funciona
- [ ] CRUD de contas a receber funciona
- [ ] Fluxo de caixa exibe dados
- [ ] Relatórios financeiros geram PDF

**Tempo Estimado:** 2-4 horas

---

#### ERRO #2: Módulo Vendas Não Funcional em Labor Energy

**Descrição:**
O módulo Vendas existe em Labor Energy mas apresenta erros críticos que impedem seu funcionamento.

**Sintomas:**
- ❌ Erro 500 ao acessar `/vendas`
- ❌ Listagem de pedidos não carrega
- ❌ Formulário de novo pedido quebrado
- ❌ Comissões não calculam

**Empresa Afetada:**
- Labor Energy (porta 3002)

**Causa Raiz:**
Análise de logs indica erro de conexão com banco de dados. A query está tentando acessar tabela `aluforce_vendas.pedidos` ao invés de `labor_energy_vendas.pedidos`.

**Arquivos com Problema:**
- `/modules/Vendas/vendas-controller.js` (linha 45)
- `/modules/Vendas/pedidos-service.js` (linha 120)

**Solução:**

1. **Corrigir queries hardcoded:**
   ```javascript
   // ANTES (ERRADO)
   const query = 'SELECT * FROM aluforce_vendas.pedidos WHERE id = ?';
   
   // DEPOIS (CORRETO)
   const dbName = process.env.DB_NAME || 'aluforce_vendas';
   const query = `SELECT * FROM ${dbName}.pedidos WHERE id = ?`;
   ```

2. **Aplicar correção em todos os arquivos:**
   ```bash
   # Buscar todas as ocorrências
   grep -r "aluforce_vendas" modules/Vendas/
   
   # Substituir por variável dinâmica
   sed -i 's/aluforce_vendas/${process.env.DB_NAME}/g' modules/Vendas/*.js
   ```

3. **Reiniciar e testar:**
   ```bash
   pm2 restart labor-energy-production
   pm2 logs labor-energy-production --lines 50
   ```

**Validação:**
- [ ] Módulo carrega sem erro 500
- [ ] Listagem de pedidos exibe dados corretos
- [ ] Criar novo pedido funciona
- [ ] Editar pedido funciona
- [ ] Excluir pedido funciona
- [ ] Comissões calculam corretamente

**Tempo Estimado:** 1-2 horas

---


### 🟠 PRIORIDADE ALTA (Resolver em 1-3 dias)

#### ERRO #3: Branding Incorreto em Labor Energy

**Descrição:**
A logo da Aluforce está sendo exibida no sistema da Labor Energy ao invés da logo correta.

**Impacto:**
- ⚠️ Identidade visual incorreta
- ⚠️ Confusão para usuários
- ⚠️ Documentos com logo errada
- ⚠️ Falta de profissionalismo

**Empresa Afetada:**
- Labor Energy (porta 3002)

**Locais com Problema:**
- Sidebar (logo principal)
- Header (logo secundária)
- Relatórios PDF
- Emails enviados
- DANFE (NFe)

**Solução:**

1. **Criar assets da empresa:**
   ```bash
   mkdir -p assets/labor-energy
   # Adicionar arquivos:
   # - logo.png (logo principal)
   # - logo-white.png (logo branca para fundos escuros)
   # - favicon.ico (ícone do navegador)
   ```

2. **Configurar middleware de branding:**
   ```javascript
   // middleware/branding.js
   function getBrandAssets(brand) {
     const brands = {
       'aluforce': {
         logo: '/assets/aluforce/logo.png',
         name: 'Aluforce Indústria e Comércio',
         cnpj: ''
       },
       'labor-energy': {
         logo: '/assets/labor-energy/logo.png',
         name: 'Labor Energy',
         cnpj: '53.937.474/0001-20'
       },
       'labor-eletric': {
         logo: '/assets/labor-eletric/logo.png',
         name: 'Labor Eletric',
         cnpj: '35.165.246/0001-06'
       }
     };
     return brands[brand] || brands['aluforce'];
   }
   ```

3. **Atualizar templates:**
   ```html
   <!-- public/sidebar.html -->
   <div class="sidebar-logo">
     <img src="<%= brandAssets.logo %>" alt="<%= brandAssets.name %>">
   </div>
   ```

4. **Atualizar geração de PDF:**
   ```javascript
   // utils/pdf-generator.js
   const brand = process.env.BRAND || 'aluforce';
   const assets = getBrandAssets(brand);
   doc.image(assets.logo, 50, 50, { width: 150 });
   ```

**Validação:**
- [ ] Logo correta na sidebar
- [ ] Logo correta no header
- [ ] Logo correta em relatórios PDF
- [ ] Logo correta em emails
- [ ] Logo correta em DANFE
- [ ] Favicon correto no navegador

**Tempo Estimado:** 2-3 horas

---

#### ERRO #4: Dados de Clientes Vazando Entre Empresas

**Descrição:**
Ao fazer login na Labor Energy, alguns clientes da Aluforce aparecem na listagem.

**Impacto:**
- 🔴 **CRÍTICO** - Vazamento de dados sensíveis
- 🔴 Violação de privacidade
- 🔴 Risco de LGPD
- 🔴 Perda de confiança

**Empresas Afetadas:**
- Labor Energy (porta 3002)
- Labor Eletric (porta 3001)

**Causa Raiz:**
Query de listagem de clientes não está filtrando por banco de dados correto.

**Arquivo com Problema:**
- `/modules/Vendas/clientes-service.js` (linha 78)

**Solução:**

1. **Corrigir query:**
   ```javascript
   // ANTES (ERRADO)
   async function listarClientes() {
     const [rows] = await pool.query('SELECT * FROM clientes');
     return rows;
   }
   
   // DEPOIS (CORRETO)
   async function listarClientes() {
     const dbName = process.env.DB_NAME;
     const [rows] = await pool.query(`SELECT * FROM ${dbName}.clientes`);
     return rows;
   }
   ```

2. **Adicionar validação de isolamento:**
   ```javascript
   // middleware/tenant-isolation.js
   function ensureTenantIsolation(req, res, next) {
     const dbName = process.env.DB_NAME;
     req.dbName = dbName;
     
     // Adicionar ao pool para todas as queries
     req.pool = pool.promise().query.bind(pool, { database: dbName });
     
     next();
   }
   ```

3. **Testar isolamento:**
   ```sql
   -- Verificar que não há referências cruzadas
   SELECT COUNT(*) as vazamentos
   FROM labor_energy_vendas.clientes c
   WHERE c.id IN (
     SELECT cliente_id FROM aluforce_vendas.vendas
   );
   -- Deve retornar 0
   ```

**Validação:**
- [ ] Clientes da Aluforce NÃO aparecem na Labor Energy
- [ ] Clientes da Labor Energy NÃO aparecem na Labor Eletric
- [ ] Cada empresa vê apenas seus próprios dados
- [ ] Teste de isolamento passa (0 vazamentos)

**Tempo Estimado:** 3-4 horas

---

### 🟡 PRIORIDADE MÉDIA (Resolver em 1 semana)

#### ERRO #5: Performance Degradada em Labor Eletric

**Descrição:**
Dashboard da Labor Eletric carrega em 8 segundos, enquanto Aluforce carrega em 2 segundos.

**Impacto:**
- ⚠️ Experiência do usuário ruim
- ⚠️ Percepção de sistema lento
- ⚠️ Produtividade reduzida

**Empresa Afetada:**
- Labor Eletric (porta 3001)

**Causa Raiz:**
Falta de índices no banco de dados `labor_eletric_vendas`.

**Solução:**

1. **Adicionar índices:**
   ```sql
   -- labor_eletric_vendas
   ALTER TABLE pedidos ADD INDEX idx_data_pedido (data_pedido);
   ALTER TABLE pedidos ADD INDEX idx_status (status);
   ALTER TABLE vendas ADD INDEX idx_vendedor_id (vendedor_id);
   ALTER TABLE produtos ADD INDEX idx_ativo (ativo);
   ```

2. **Otimizar queries:**
   ```javascript
   // ANTES (lento)
   SELECT * FROM pedidos WHERE YEAR(data_pedido) = 2026;
   
   // DEPOIS (rápido)
   SELECT * FROM pedidos 
   WHERE data_pedido >= '2026-01-01' 
   AND data_pedido < '2027-01-01';
   ```

3. **Adicionar cache:**
   ```javascript
   const cacheKey = `dashboard:stats:${dbName}`;
   let stats = await cache.get(cacheKey);
   
   if (!stats) {
     stats = await calcularEstatisticas();
     await cache.set(cacheKey, stats, 300); // 5 min
   }
   ```

**Validação:**
- [ ] Dashboard carrega em < 3 segundos
- [ ] Queries executam em < 100ms
- [ ] Cache funcionando corretamente

**Tempo Estimado:** 2-3 horas

---


## 📊 ANÁLISE DETALHADA POR MÓDULO

### 1. DASHBOARD

| Aspecto | Aluforce | Labor Energy | Labor Eletric |
|---------|----------|--------------|---------------|
| Carregamento | ✅ 2.1s | ⚠️ 4.5s | ❌ 8.2s |
| KPIs | ✅ OK | ✅ OK | ⚠️ Dados incorretos |
| Gráficos | ✅ OK | ✅ OK | ✅ OK |
| Pedidos Recentes | ✅ OK | ⚠️ Vazio | ⚠️ Vazio |
| Fluxo Financeiro | ✅ OK | ❌ Erro 500 | ❌ Erro 500 |
| Metas do Mês | ⚠️ Remover | ⚠️ Remover | ⚠️ Remover |

**Problemas Identificados:**
1. **Labor Energy:** Pedidos recentes não carregam (query vazia)
2. **Labor Eletric:** Performance degradada (falta de índices)
3. **Todas:** Widget "Metas do Mês" deve ser removido (não implementado)

**Correções Necessárias:**
```javascript
// Remover widget "Metas do Mês"
// public/dashboard.html - remover linhas 145-178

// Corrigir Pedidos Recentes
async function getPedidosRecentes() {
  const dbName = process.env.DB_NAME;
  const [rows] = await pool.query(`
    SELECT p.*, c.nome as cliente_nome
    FROM ${dbName}.pedidos p
    LEFT JOIN ${dbName}.clientes c ON p.cliente_id = c.id
    ORDER BY p.data_pedido DESC
    LIMIT 10
  `);
  return rows;
}

// Corrigir Fluxo Financeiro
async function getFluxoFinanceiro() {
  const dbName = process.env.DB_NAME;
  const [rows] = await pool.query(`
    SELECT 
      DATE(data_vencimento) as data,
      SUM(CASE WHEN tipo = 'receber' THEN valor ELSE 0 END) as entradas,
      SUM(CASE WHEN tipo = 'pagar' THEN valor ELSE 0 END) as saidas
    FROM ${dbName}.financeiro
    WHERE data_vencimento >= CURDATE()
    AND data_vencimento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(data_vencimento)
    ORDER BY data
  `);
  return rows;
}
```

---

### 2. VENDAS

| Aspecto | Aluforce | Labor Energy | Labor Eletric |
|---------|----------|--------------|---------------|
| Listagem | ✅ OK | ❌ Erro 500 | ❌ Ausente |
| Criar Pedido | ✅ OK | ❌ Erro 500 | ❌ Ausente |
| Editar Pedido | ✅ OK | ❌ Erro 500 | ❌ Ausente |
| Comissões | ✅ OK | ❌ Não calcula | ❌ Ausente |
| Orçamentos | ✅ OK | ⚠️ Parcial | ❌ Ausente |

**Problemas Identificados:**
1. **Labor Energy:** Módulo existe mas não funciona (erro de DB)
2. **Labor Eletric:** Módulo completamente ausente

**Correções Necessárias:**
```bash
# Labor Energy - Corrigir queries
sed -i 's/aluforce_vendas/${process.env.DB_NAME}/g' modules/Vendas/*.js

# Labor Eletric - Copiar módulo completo
cp -r modules/Vendas/ Base/Labor-Eletric/modules/
```

---

### 3. FATURAMENTO

| Aspecto | Aluforce | Labor Energy | Labor Eletric |
|---------|----------|--------------|---------------|
| Listagem NFe | ✅ OK | ✅ OK | ✅ OK |
| Emitir NFe | ✅ OK | ⚠️ CNPJ errado | ⚠️ CNPJ errado |
| Transmitir SEFAZ | ✅ OK | ⚠️ Certificado | ⚠️ Certificado |
| Gerar DANFE | ✅ OK | ⚠️ Logo errada | ⚠️ Logo errada |
| Cancelar NFe | ✅ OK | ✅ OK | ✅ OK |

**Problemas Identificados:**
1. **Labor Energy:** CNPJ hardcoded da Aluforce
2. **Labor Eletric:** CNPJ hardcoded da Aluforce
3. **Ambas:** Logo da Aluforce em DANFE

**Correções Necessárias:**
```javascript
// config/nfe.config.js
function getNFeConfig() {
  const configs = {
    'aluforce': {
      cnpj: '',
      razaoSocial: 'Aluforce Indústria e Comércio',
      certificado: '/cert/aluforce.pfx'
    },
    'labor-energy': {
      cnpj: '53.937.474/0001-20',
      razaoSocial: 'Labor Energy',
      certificado: '/cert/labor-energy.pfx'
    },
    'labor-eletric': {
      cnpj: '35.165.246/0001-06',
      razaoSocial: 'Labor Eletric',
      certificado: '/cert/labor-eletric.pfx'
    }
  };
  
  const brand = process.env.BRAND || 'aluforce';
  return configs[brand];
}
```

---

### 4. FINANCEIRO

| Aspecto | Aluforce | Labor Energy | Labor Eletric |
|---------|----------|--------------|---------------|
| Módulo Existe | ✅ Sim | ❌ Não | ❌ Não |
| Contas a Pagar | ✅ OK | ❌ N/A | ❌ N/A |
| Contas a Receber | ✅ OK | ❌ N/A | ❌ N/A |
| Fluxo de Caixa | ✅ OK | ❌ N/A | ❌ N/A |
| Conciliação | ✅ OK | ❌ N/A | ❌ N/A |

**Problema Crítico:**
Módulo Financeiro completamente ausente em Labor Energy e Labor Eletric.

**Correção:**
Ver **ERRO #1** na seção de Inconsistências Críticas acima.

---

### 5. PCP (Planejamento e Controle de Produção)

| Aspecto | Aluforce | Labor Energy | Labor Eletric |
|---------|----------|--------------|---------------|
| Módulo Existe | ✅ Sim | ❌ Não | ⚠️ Parcial |
| Ordens de Produção | ✅ OK | ❌ N/A | ⚠️ Lista vazia |
| Apontamentos | ✅ OK | ❌ N/A | ⚠️ Erro ao salvar |
| Kanban | ✅ OK | ❌ N/A | ❌ Não carrega |

**Problemas Identificados:**
1. **Labor Energy:** Módulo ausente
2. **Labor Eletric:** Módulo existe mas não funciona

**Correções Necessárias:**
```bash
# Labor Energy - Copiar módulo
cp -r modules/PCP/ Base/Labor-Energy/modules/

# Labor Eletric - Corrigir queries
grep -r "aluforce_vendas" modules/PCP/ | cut -d: -f1 | sort -u | \
  xargs sed -i 's/aluforce_vendas/${process.env.DB_NAME}/g'
```

---

## 🔄 PLANO DE AÇÃO CONSOLIDADO

### Fase 1: Correções Críticas (0-24h)

**Prioridade 1 - Módulos Ausentes:**
1. ✅ Copiar módulo Financeiro para Labor Energy
2. ✅ Copiar módulo Financeiro para Labor Eletric
3. ✅ Copiar módulo Vendas para Labor Eletric
4. ✅ Copiar módulo PCP para Labor Energy
5. ✅ Copiar módulo Logística para Labor Energy
6. ✅ Copiar módulo Logística para Labor Eletric
7. ✅ Copiar módulo CRM para Labor Energy
8. ✅ Copiar módulo CRM para Labor Eletric

**Prioridade 2 - Correção de Queries:**
1. ✅ Substituir `aluforce_vendas` por `${process.env.DB_NAME}` em TODOS os arquivos
2. ✅ Testar isolamento de dados
3. ✅ Validar que não há vazamento entre empresas

**Prioridade 3 - Branding:**
1. ✅ Configurar logos corretas
2. ✅ Configurar CNPJs corretos
3. ✅ Atualizar templates de documentos

### Fase 2: Correções Altas (1-3 dias)

1. ✅ Corrigir performance da Labor Eletric (índices)
2. ✅ Corrigir certificados digitais NFe
3. ✅ Implementar cache distribuído
4. ✅ Configurar rate limiting por empresa

### Fase 3: Correções Médias (1 semana)

1. ✅ Padronizar interface entre empresas
2. ✅ Implementar testes automatizados
3. ✅ Documentar diferenças permitidas
4. ✅ Criar guia de deploy multi-company

### Fase 4: Melhorias (1 mês)

1. ✅ Implementar feature flags por empresa
2. ✅ Criar dashboard de monitoramento multi-company
3. ✅ Implementar backup automático por empresa
4. ✅ Criar documentação técnica completa

---


## ✅ CHECKLIST DE VALIDAÇÃO FINAL

Após implementar todas as correções, executar este checklist:

### Validação de Padronização

#### Módulos
- [ ] Todas as 3 empresas têm os mesmos 12 módulos
- [ ] Todos os módulos carregam sem erro
- [ ] Todas as funcionalidades CRUD funcionam
- [ ] Todos os relatórios geram corretamente

#### Interface
- [ ] Layouts idênticos entre empresas
- [ ] Mesmos campos nos formulários
- [ ] Mesmas colunas nas tabelas
- [ ] Mesmos botões e ações

#### Backend
- [ ] Todas as APIs respondem corretamente
- [ ] Queries retornam dados corretos
- [ ] Validações funcionam
- [ ] Erros são tratados adequadamente

### Validação de Isolamento

#### Dados
- [ ] Clientes isolados por empresa
- [ ] Pedidos isolados por empresa
- [ ] Vendas isoladas por empresa
- [ ] Produtos isolados (ou compartilhados conforme regra)
- [ ] Financeiro isolado por empresa
- [ ] Usuários isolados por empresa

#### Sessões
- [ ] Login em uma empresa não dá acesso a outra
- [ ] Tokens JWT específicos por empresa
- [ ] Cookies isolados por porta
- [ ] Logout limpa sessão corretamente

#### Testes de Vazamento
```sql
-- Teste 1: Clientes não vazam
SELECT COUNT(*) FROM labor_energy_vendas.clientes 
WHERE id IN (SELECT cliente_id FROM aluforce_vendas.vendas);
-- Esperado: 0

-- Teste 2: Pedidos não vazam
SELECT COUNT(*) FROM labor_eletric_vendas.pedidos 
WHERE id IN (SELECT pedido_id FROM labor_energy_vendas.itens_pedido);
-- Esperado: 0

-- Teste 3: Usuários não vazam
SELECT COUNT(*) FROM aluforce_vendas.usuarios 
WHERE id IN (SELECT usuario_id FROM labor_energy_vendas.auditoria_logs);
-- Esperado: 0
```

### Validação de Branding

#### Visual
- [ ] Logo correta em sidebar (todas as empresas)
- [ ] Logo correta em header (todas as empresas)
- [ ] Favicon correto (todas as empresas)
- [ ] Título da página correto (todas as empresas)

#### Documentos
- [ ] Orçamentos com logo correta
- [ ] Pedidos com dados corretos
- [ ] NFe com CNPJ correto
- [ ] DANFE com logo correta
- [ ] Relatórios PDF com branding correto
- [ ] Emails com assinatura correta

### Validação de Performance

#### Tempos de Carregamento
- [ ] Dashboard < 3s (todas as empresas)
- [ ] Listagens < 2s (todas as empresas)
- [ ] Relatórios < 5s (todas as empresas)
- [ ] APIs < 500ms (todas as empresas)

#### Recursos
- [ ] Uso de memória similar (±20%)
- [ ] Uso de CPU similar (±20%)
- [ ] Conexões DB similar (±20%)
- [ ] Sem memory leaks

### Validação de Segurança

#### Autenticação
- [ ] Login funciona (todas as empresas)
- [ ] Logout funciona (todas as empresas)
- [ ] Sessões expiram corretamente
- [ ] Senhas criptografadas (bcrypt)

#### Autorização
- [ ] Permissões por módulo funcionam
- [ ] Permissões por ação funcionam
- [ ] Admin tem acesso total
- [ ] Usuários comuns têm acesso limitado

#### Proteções
- [ ] CSRF protection ativo
- [ ] SQL Injection protegido
- [ ] XSS protegido
- [ ] Rate limiting ativo
- [ ] HTTPS em produção

---

## 📈 MÉTRICAS DE SUCESSO

### Metas de Padronização

| Métrica | Meta | Atual | Status |
|---------|------|-------|--------|
| Módulos Padronizados | 100% | [%] | 🔴/🟡/🟢 |
| Funcionalidades Idênticas | 100% | [%] | 🔴/🟡/🟢 |
| Taxa de Sucesso de Testes | ≥95% | [%] | 🔴/🟡/🟢 |
| Isolamento de Dados | 100% | [%] | 🔴/🟡/🟢 |
| Branding Correto | 100% | [%] | 🔴/🟡/🟢 |

### Metas de Performance

| Métrica | Meta | Aluforce | Labor Energy | Labor Eletric |
|---------|------|----------|--------------|---------------|
| Dashboard Load | <3s | [s] | [s] | [s] |
| API Response | <500ms | [ms] | [ms] | [ms] |
| Report Generation | <5s | [s] | [s] | [s] |
| Memory Usage | <1GB | [MB] | [MB] | [MB] |

### Metas de Qualidade

| Métrica | Meta | Atual | Status |
|---------|------|-------|--------|
| Erros 500 | 0 | [n] | 🔴/🟡/🟢 |
| Erros 404 | 0 | [n] | 🔴/🟡/🟢 |
| Erros de Console | 0 | [n] | 🔴/🟡/🟢 |
| Warnings | <10 | [n] | 🔴/🟡/🟢 |

---

## 🚀 COMANDOS ÚTEIS

### Iniciar Análise
```bash
# Executar análise automatizada
node scripts/analyze-multi-company.js

# Com verbose
node scripts/analyze-multi-company.js --verbose

# Apenas comparação (sem testes)
node scripts/analyze-multi-company.js --compare-only
```

### Verificar Status
```bash
# Status dos servidores
pm2 list

# Logs em tempo real
pm2 logs aluforce-production
pm2 logs labor-energy-production
pm2 logs labor-eletric-production

# Monitoramento
pm2 monit
```

### Testar Isolamento
```bash
# Testar isolamento de dados
node scripts/test-data-isolation.js

# Testar vazamento de sessões
node scripts/test-session-isolation.js

# Testar branding
node scripts/test-branding.js
```

### Aplicar Correções
```bash
# Aplicar todas as correções críticas
node scripts/apply-critical-fixes.js

# Aplicar correções de branding
node scripts/apply-branding-fixes.js

# Aplicar correções de performance
node scripts/apply-performance-fixes.js
```

### Validar Correções
```bash
# Re-executar análise
node scripts/analyze-multi-company.js

# Executar testes automatizados
npm run test:multi-company

# Gerar relatório final
node scripts/generate-final-report.js
```

---

## 📚 DOCUMENTAÇÃO ADICIONAL

### Arquitetura Multi-Company

```
/Zyntra
  /modules              # Módulos compartilhados (base)
    /Dashboard
    /Vendas
    /Faturamento
    /Financeiro
    /PCP
    /Compras
    /Estoque
    /RH
    /Admin
    /Relatorios
  
  /Base                 # Configurações específicas por empresa
    /Aluforce
      .env
      logo.png
      certificado.pfx
    /Labor-Energy
      .env
      logo.png
      certificado.pfx
    /Labor-Eletric
      .env
      logo.png
      certificado.pfx
  
  /config               # Configurações globais
    database.js
    nfe.config.js
    branding.js
  
  server.js             # Servidor único multi-tenant
  ecosystem.config.js   # PM2 config Aluforce
  ecosystem.labor-energy.config.js
  ecosystem.labor-eletric.config.js
```

### Variáveis de Ambiente por Empresa

**Aluforce (.env):**
```env
NODE_ENV=production
PORT=3000
BRAND=aluforce
DB_NAME=aluforce_vendas
DB_HOST=localhost
DB_USER=aluforce
DB_PASSWORD=[SENHA_SEGURA]
```

**Labor Energy (.env):**
```env
NODE_ENV=production
PORT=3002
BRAND=labor-energy
DB_NAME=labor_energy_vendas
DB_HOST=localhost
DB_USER=aluforce
DB_PASSWORD=[SENHA_SEGURA]
```

**Labor Eletric (.env):**
```env
NODE_ENV=production
PORT=3001
BRAND=labor-eletric
DB_NAME=labor_eletric_vendas
DB_HOST=localhost
DB_USER=aluforce
DB_PASSWORD=[SENHA_SEGURA]
```

---

## 🎓 BOAS PRÁTICAS MULTI-COMPANY

### 1. Código Compartilhado
✅ **FAZER:**
- Usar variáveis de ambiente para configurações
- Usar `process.env.DB_NAME` em queries
- Usar `process.env.BRAND` para branding
- Centralizar lógica de negócio

❌ **NÃO FAZER:**
- Hardcodar nomes de bancos
- Hardcodar CNPJs
- Duplicar código entre empresas
- Criar branches separados por empresa

### 2. Isolamento de Dados
✅ **FAZER:**
- Sempre filtrar por `DB_NAME`
- Usar bancos de dados separados
- Validar isolamento em testes
- Auditar queries regularmente

❌ **NÃO FAZER:**
- Compartilhar tabelas entre empresas
- Usar JOINs cross-database
- Confiar apenas em filtros WHERE
- Ignorar testes de isolamento

### 3. Branding
✅ **FAZER:**
- Usar middleware de branding
- Carregar assets dinamicamente
- Validar branding em CI/CD
- Testar documentos gerados

❌ **NÃO FAZER:**
- Hardcodar logos em HTML
- Usar assets da empresa errada
- Esquecer de atualizar templates
- Ignorar emails e PDFs

### 4. Performance
✅ **FAZER:**
- Criar índices em todas as empresas
- Usar cache por empresa
- Monitorar performance individual
- Otimizar queries igualmente

❌ **NÃO FAZER:**
- Otimizar apenas uma empresa
- Compartilhar cache entre empresas
- Ignorar diferenças de performance
- Usar queries diferentes

---

## 📞 SUPORTE E CONTATO

### Em Caso de Dúvidas
- **Documentação:** `/docs/multi-company.md`
- **Wiki:** `https://wiki.zyntra.com.br/multi-company`
- **Suporte:** suporte@zyntra.com.br

### Reportar Problemas
- **Issues:** `https://github.com/zyntra/erp/issues`
- **Slack:** `#multi-company-support`
- **Email:** dev@zyntra.com.br

---

**Arquivo gerado por:** Análise Multi-Company Automatizada  
**Versão:** 1.0  
**Data:** [DATA_ATUAL]  
**Próxima Análise:** Executar semanalmente ou após cada deploy

---

## ✨ CONCLUSÃO

Este arquivo contém **TODAS** as correções necessárias para padronizar as 3 empresas do sistema Zyntra ERP.

### Próximos Passos

1. ✅ **Revisar este arquivo** - Ler todas as correções propostas
2. ✅ **Priorizar por severidade** - Começar pelas críticas
3. ✅ **Implementar correções** - Seguir instruções detalhadas
4. ✅ **Testar cada correção** - Validar antes de próxima
5. ✅ **Re-executar análise** - Verificar se problemas foram resolvidos
6. ✅ **Documentar mudanças** - Atualizar CHANGELOG
7. ✅ **Deploy em produção** - Após validação completa

### Meta Final
**Taxa de Sucesso: ≥95%** em todas as empresas com **0 inconsistências críticas**.

---

**🎯 Objetivo Alcançado Quando:**
- ✅ Todas as 3 empresas têm os mesmos módulos
- ✅ Todas as funcionalidades são idênticas
- ✅ Isolamento de dados é 100% garantido
- ✅ Branding está correto em todos os lugares
- ✅ Performance é similar entre empresas
- ✅ Testes automatizados passam 100%

**Boa sorte com as correções! 🚀**
```

---



## 🤖 INSTRUÇÕES PARA IA/AGENTE

Se você é uma IA (Claude, GPT, Cursor, etc.) executando este prompt, siga estas instruções:

### 1. ANÁLISE INICIAL
- Leia TODOS os arquivos do sistema
- Identifique a estrutura multi-company atual
- Mapeie todos os módulos existentes
- Identifique configurações por empresa

### 2. COMPARAÇÃO SISTEMÁTICA
Para cada módulo:
1. Verifique se existe em Aluforce
2. Verifique se existe em Labor Energy
3. Verifique se existe em Labor Eletric
4. Compare funcionalidades
5. Identifique diferenças

### 3. TESTES DE ISOLAMENTO
Execute queries para verificar:
```sql
-- Teste de vazamento de clientes
SELECT 'VAZAMENTO DETECTADO' as alerta, COUNT(*) as registros
FROM labor_energy_vendas.clientes 
WHERE id IN (SELECT cliente_id FROM aluforce_vendas.vendas)
HAVING COUNT(*) > 0;

-- Teste de vazamento de pedidos
SELECT 'VAZAMENTO DETECTADO' as alerta, COUNT(*) as registros
FROM labor_eletric_vendas.pedidos 
WHERE id IN (SELECT pedido_id FROM labor_energy_vendas.itens_pedido)
HAVING COUNT(*) > 0;
```

### 4. ANÁLISE DE CÓDIGO
Busque por:
- `aluforce_vendas` hardcoded (deve usar variável)
- CNPJs hardcoded (deve usar config)
- Logos hardcoded (deve usar branding)
- Queries sem filtro de empresa

### 5. GERAÇÃO DO ARQUIVO
Crie `CORRECOES-MULTI-COMPANY-COMPLETO.md` com:
- Resumo executivo com estatísticas
- Matriz de comparação detalhada
- Lista de inconsistências por severidade
- Instruções de correção com código
- Checklist de validação
- Comandos para aplicar correções

### 6. FORMATO DAS CORREÇÕES
Para cada erro encontrado, forneça:
```markdown
#### ERRO #X: [Título Descritivo]

**Descrição:**
[Explicação clara do problema]

**Impacto:**
- [Consequência 1]
- [Consequência 2]

**Empresas Afetadas:**
- [Lista de empresas]

**Arquivos Envolvidos:**
- [Lista de arquivos]

**Solução:**
[Código completo para correção]

**Validação:**
- [ ] [Checklist item 1]
- [ ] [Checklist item 2]

**Tempo Estimado:** [X horas]
```

### 7. PRIORIZAÇÃO
Classifique erros por severidade:
- 🔴 **CRÍTICA** - Sistema não funciona, dados vazam, segurança comprometida
- 🟠 **ALTA** - Funcionalidade importante quebrada, branding errado
- 🟡 **MÉDIA** - Performance degradada, UX ruim
- 🟢 **BAIXA** - Melhorias, otimizações, refatorações

### 8. VALIDAÇÃO FINAL
Antes de entregar o arquivo:
- ✅ Todas as inconsistências foram documentadas
- ✅ Todas as correções têm código completo
- ✅ Todas as correções têm validação
- ✅ Arquivo está bem formatado
- ✅ Estatísticas estão corretas
- ✅ Comandos foram testados

---

## 📋 TEMPLATE DE RESPOSTA

Quando executar este prompt, responda no seguinte formato:

```markdown
# 🔍 ANÁLISE MULTI-COMPANY EXECUTADA

## Resumo da Análise
- **Data:** [data/hora]
- **Módulos Analisados:** [número]
- **Arquivos Verificados:** [número]
- **Inconsistências Encontradas:** [número]
- **Tempo de Análise:** [minutos]

## Estatísticas por Empresa

### Aluforce
- Módulos: X/12 funcionais
- Taxa de Sucesso: Y%
- Problemas: Z

### Labor Energy
- Módulos: X/12 funcionais
- Taxa de Sucesso: Y%
- Problemas: Z

### Labor Eletric
- Módulos: X/12 funcionais
- Taxa de Sucesso: Y%
- Problemas: Z

## Arquivo Gerado
✅ `CORRECOES-MULTI-COMPANY-COMPLETO.md` criado com sucesso

## Próximos Passos
1. Revisar arquivo de correções
2. Implementar correções críticas (0-24h)
3. Implementar correções altas (1-3 dias)
4. Re-executar análise para validar
5. Deploy em produção

## Observações
[Qualquer observação importante sobre a análise]
```

---

**FIM DO PROMPT MELHORADO** 🎯

Este prompt agora está:
- ✅ **Estruturado** - Seções claras e organizadas
- ✅ **Detalhado** - Instruções específicas e completas
- ✅ **Acionável** - Código pronto para implementar
- ✅ **Validável** - Checklists para verificar correções
- ✅ **Profissional** - Formato enterprise-grade
- ✅ **Completo** - Cobre todos os aspectos necessários

Use este prompt para realizar análises multi-company completas e gerar arquivos de correção detalhados! 🚀
